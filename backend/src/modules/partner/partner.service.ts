import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  bonusLabel,
  bonusesFor,
  campaignBonuses,
  claimIdFromReferrer,
  codeFromReferrer,
} from '../../common/attribution';
import { recordDecision } from '../../common/obs';
import { splitFee } from '../../common/rates';
import { str } from '../../common/security';
import { orgFromKey } from './api-key';
import { ClaimBody, FirstOpenBody } from './dto/bodies.dto';
import { Carried, MatchMethod, PartnerRepository } from './partner.repository';

const CARRIERS = ['referrer', 'appclip', 'pasteboard'] as const;

/** The org an API key resolves to — only the two fields this surface reads. */
interface Publisher {
  id: string;
  bonuses: unknown;
}

/**
 * What the Partner API *means*, on top of what the repository reads and writes: what an incoming
 * body is allowed to say, how a device-integrity assertion is graded, which offers a campaign
 * advertises, the two response shapes publishers integrate against, and the decision series that
 * is the only symptom of a misconfigured integration.
 *
 * Every method takes the raw `Authorization` header rather than an org, because this surface has
 * no guard: the API key *is* the request's identity, and resolving it is the first thing any of
 * these do.
 */
@Injectable()
export class PartnerService {
  constructor(private readonly repo: PartnerRepository) {}

  private publisherFromKey(auth: string): Promise<Publisher> {
    return orgFromKey(auth, 'publisher');
  }

  /** Parse and bound the claim half of a request body — it arrives from another company's server.
   *  The old iOS fingerprint fields are ignored rather than rejected, so an un-upgraded SDK
   *  degrades to "no claim carried". */
  private readCarried(b: Record<string, unknown>): Carried {
    const install_referrer = str(b.install_referrer, 'install_referrer', 1000, false);
    // Wrapped back into referrer shape rather than re-validated, so there is one definition of the
    // shape. Malformed is a 400: a silent drop turns a broken integration into zero attribution.
    const raw = str(b.claim_id, 'claim_id', 64, false);
    const bare = raw ? claimIdFromReferrer(`qrm_claim=${raw}`) : null;
    if (raw && !bare)
      throw new BadRequestException('claim_id must be the opaque id the scan issued');

    // Believed because it decides nothing — every carrier pays the same fee. Absent means
    // `referrer`; the more specific claims must not be invented.
    const claimed = str(b.carrier, 'carrier', 20, false);
    const carrier = (CARRIERS as readonly string[]).includes(claimed ?? '')
      ? (claimed as MatchMethod)
      : 'referrer';

    return { claimId: bare ?? claimIdFromReferrer(install_referrer), carrier };
  }

  // ------------------------------------------------------------------------------- first open

  async firstOpen(auth: string, b: FirstOpenBody) {
    const publisher = await this.publisherFromKey(auth);
    const carried = this.readCarried(b as Record<string, unknown>);
    if (!carried.claimId)
      throw new BadRequestException(
        'install_referrer or claim_id required to attribute an install',
      );

    /**
     * Asserted by the SDK, never observed, so graded rather than trusted: `emulator` blocks,
     * `rooted` and `vpn` are recorded only — the honest populations are too large to refuse.
     * Stored on accepted installs too: the pattern worth finding is the one that got paid.
     */
    const risk = {
      emulator: b.emulator === true,
      rooted: b.rooted === true,
      vpn: b.vpn === true,
    };
    if (risk.emulator) {
      recordDecision('first_open', { reason: 'device_integrity' }, { publisher_org_id: publisher.id });
      return { attributed: false, reason: 'device_integrity' };
    }

    const bound = await this.repo.bindInstall(publisher.id, carried, risk);

    // One record per first-open, refused or bound: a misconfigured store target produces no
    // errors and writes no rows, so this series is the only symptom.
    if (bound.status === 'unattributed') {
      recordDecision(
        'first_open',
        { reason: bound.reason, confidence: bound.confidence },
        { publisher_org_id: publisher.id },
      );
      return { attributed: false, reason: bound.reason, confidence: bound.confidence };
    }

    const { scan, match_method, confidence, install_id, expires_at } = bound;
    recordDecision(
      'first_open',
      { match_method, confidence },
      { publisher_org_id: publisher.id, campaign_id: scan.campaign_id },
    );

    // What *this campaign* advertises, not everything the publisher runs — the artwork was
    // printed off these.
    const granted = campaignBonuses(publisher.bonuses, 'acquisition', scan.bonus_types);

    return {
      attributed: true,
      /** present this at signup. Not a credential and not spendable — it names an install. */
      install_id,
      campaign_id: scan.campaign_id,
      campaign_name: scan.campaign_name,
      /** which carrier brought the claim id back: referrer | appclip | pasteboard */
      match_method,
      /** always 100 — every carrier names one exact scan. Kept for API compatibility. */
      confidence,
      signup_deadline: expires_at.toISOString(),
      bonuses: granted,
      bonus_label: bonusLabel(granted),
    };
  }

  // ------------------------------------------------------------------------------ acquisition

  async claim(auth: string, b: ClaimBody) {
    const publisher = await this.publisherFromKey(auth);
    const bonuses = bonusesFor(publisher.bonuses, 'acquisition');
    // Bounded before anything is parsed or stored — attacker-shaped strings from another server.
    const publisher_user_ref = str(b.publisher_user_ref, 'publisher_user_ref', 200)!;
    const install_id = str(b.install_id, 'install_id', 36, false);

    // Wrapped back into referrer shape so there is one definition of an issued code. Malformed is
    // a 400, never a fallthrough to the acquisition path.
    const rawCode = str(b.code, 'code', 1000, false);
    const code = rawCode ? codeFromReferrer(`qrm_code=${rawCode}`) ?? codeFromReferrer(rawCode) : null;
    if (rawCode && !code)
      throw new BadRequestException('code must be the transaction code issued to this purchase');
    if (code) return this.claimPurchase(publisher, code, publisher_user_ref);

    const carried = install_id ? null : this.readCarried(b as Record<string, unknown>);
    if (carried && !carried.claimId)
      throw new BadRequestException(
        'install_id, or install_referrer/claim_id, required to attribute a signup',
      );

    // Every refusal funnels through here, including ones raised inside a rolled-back transaction.
    const unattributed = (reason: string) => {
      recordDecision('claim', { reason }, { publisher_org_id: publisher.id });
      return { attributed: false, reason, bonuses, bonus_label: bonusLabel(bonuses) };
    };

    /** The fee buys an *acquisition*, and only the publisher knows an account is new. Refused
     *  before the install is spent. The UNIQUE on (campaign, ref) catches the same ref twice;
     *  this catches a returning user handed a fresh one. */
    if (b.is_new_user === false) return unattributed('not_a_new_user');

    const identified = b.identified === true;
    const result = await this.repo.recordAcquisition(publisher.id, {
      install_id,
      carried,
      publisher_user_ref,
      identified,
    });

    if (result.status === 'unattributed') return unattributed(result.reason);

    if (result.status === 'attributed') {
      const { scan, match_method, confidence, fee, net, cut, redemption_id } = result;
      recordDecision(
        'claim',
        { match_method, confidence },
        {
          publisher_org_id: publisher.id,
          campaign_id: scan.campaign_id,
          attribution_id: redemption_id,
          fee,
          platform_fee: cut,
          identified: result.identified,
        },
      );

      const granted = campaignBonuses(publisher.bonuses, 'acquisition', scan.bonus_types);

      return {
        attributed: true,
        attribution_id: redemption_id,
        campaign_id: scan.campaign_id,
        campaign_name: scan.campaign_name,
        match_method,
        confidence,
        identified: result.identified,
        /** gross marketing fee, in platform credits — what the campaign budget spent. */
        fee,
        /** what actually landed in the publisher's account: fee minus the platform's cut */
        publisher_net: net,
        platform_fee: cut,
        pending_fee: result.identified ? 0 : scan.coin_rate - scan.guest_rate,
        confirm_deadline: result.identified
          ? null
          : new Date(Date.now() + scan.grace_days * 86_400_000).toISOString(),
        /** the offers this campaign advertises. A description, never an instruction. */
        bonuses: granted,
        bonus_label: bonusLabel(granted),
        /** false on the first answer for this user; see the replay note on retries. */
        replay: false,
      };
    }

    /** Replay: already attributed, which in practice means the first call succeeded and its
     *  response was lost. A 409 would make a correct attribution look like something to reconcile
     *  by hand, so the original answer is replayed verbatim. */
    const prior = await this.repo.priorAcquisition(result.campaign_id, publisher_user_ref);
    // Gone only if the campaign was deleted between the two calls; nothing left to replay.
    if (!prior) throw new ConflictException('duplicate_user');
    const { coin_rate, grace_days, platform_fee_bps } = prior.campaign.partnership;
    const split = splitFee(prior.coins, platform_fee_bps);
    const granted = campaignBonuses(publisher.bonuses, 'acquisition', prior.campaign.bonus_types);
    // Counted separately: a replay moved no money, and a climbing replay rate means retries firing.
    recordDecision(
      'claim',
      { reason: 'replay', match_method: prior.match_method, confidence: prior.confidence },
      { publisher_org_id: publisher.id, campaign_id: prior.campaign_id, attribution_id: prior.id },
    );
    return {
      attributed: true,
      attribution_id: prior.id,
      campaign_id: prior.campaign_id,
      campaign_name: prior.campaign.name,
      match_method: prior.match_method,
      confidence: prior.confidence,
      identified: prior.identified,
      fee: prior.coins,
      publisher_net: split.net,
      platform_fee: split.cut,
      pending_fee: prior.identified ? 0 : coin_rate - prior.coins,
      confirm_deadline: prior.identified
        ? null
        : new Date(prior.created_at.getTime() + grace_days * 86_400_000).toISOString(),
      bonuses: granted,
      bonus_label: bonusLabel(granted),
      replay: true,
    };
  }

  // ------------------------------------------------------------------------------- engagement

  /**
   * The engagement payout: a repeat purchase, paid on the code that proves it happened.
   *
   * Not routed through the acquisition machinery — that is all device recognition, which has no
   * question to answer here.
   */
  private async claimPurchase(publisher: Publisher, code: string, publisher_user_ref: string) {
    const bonuses = bonusesFor(publisher.bonuses, 'engagement');
    const unattributed = (reason: string) => {
      recordDecision('claim', { reason, match_method: 'code' }, { publisher_org_id: publisher.id });
      return { attributed: false, reason, bonuses, bonus_label: bonusLabel(bonuses) };
    };

    const result = await this.repo.recordEngagement(publisher.id, code, publisher_user_ref);

    if (result.status === 'unattributed') return unattributed(result.reason);

    if (result.status === 'attributed') {
      const { match, fee, net, cut, redemption_id } = result;
      recordDecision(
        'claim',
        { match_method: 'code', confidence: 100 },
        {
          publisher_org_id: publisher.id,
          campaign_id: match.campaign_id,
          attribution_id: redemption_id,
          fee,
          platform_fee: cut,
          kind: 'engagement',
        },
      );

      const granted = campaignBonuses(publisher.bonuses, 'engagement', match.bonus_types);

      return {
        attributed: true,
        attribution_id: redemption_id,
        campaign_id: match.campaign_id,
        campaign_name: match.campaign_name,
        /** `engagement` — a repeat purchase, not a signup. The two are priced separately. */
        kind: 'engagement',
        match_method: 'code',
        confidence: 100,
        identified: true,
        /** gross marketing fee, in platform credits — what the campaign budget spent. */
        fee,
        /** what actually landed in the publisher's account: fee minus the platform's cut */
        publisher_net: net,
        platform_fee: cut,
        /** always 0 and always null: an engagement payout settles in one step. */
        pending_fee: 0,
        confirm_deadline: null,
        /** the offers this campaign advertises, echoed back. Never an instruction. */
        bonuses: granted,
        bonus_label: bonusLabel(granted),
        replay: false,
      };
    }

    const prior = await this.repo.priorEngagement(result.qr_code_id);
    if (!prior) throw new ConflictException('already_claimed');
    const priorSplit = splitFee(prior.coins, prior.campaign.partnership.platform_fee_bps);
    const granted = campaignBonuses(publisher.bonuses, 'engagement', prior.campaign.bonus_types);

    /** Same user: the first call's response was lost, so replay it. Different user: somebody
     *  else's boarding pass, forwarded or shared — replaying would hand them a reward the first
     *  earned. */
    if (prior.publisher_user_ref !== publisher_user_ref) return unattributed('already_claimed');

    recordDecision(
      'claim',
      { reason: 'replay', match_method: 'code', confidence: 100 },
      { publisher_org_id: publisher.id, campaign_id: prior.campaign_id, attribution_id: prior.id },
    );
    return {
      attributed: true,
      attribution_id: prior.id,
      campaign_id: prior.campaign_id,
      campaign_name: prior.campaign.name,
      kind: 'engagement',
      match_method: prior.match_method,
      confidence: prior.confidence,
      identified: true,
      fee: prior.coins,
      publisher_net: priorSplit.net,
      platform_fee: priorSplit.cut,
      pending_fee: 0,
      confirm_deadline: null,
      bonuses: granted,
      bonus_label: bonusLabel(granted),
      replay: true,
    };
  }

  // ---------------------------------------------------------------------------------- confirm

  async confirm(auth: string, id: string) {
    const publisher = await this.publisherFromKey(auth);
    const res = await this.repo.confirm(publisher.id, id);
    return res.status === 'already_full'
      ? { attribution_id: res.id, fee: res.fee, identified: true, status: 'already_full' }
      : {
          attribution_id: res.id,
          fee: res.fee,
          fee_added: res.fee_added,
          identified: true,
          status: 'confirmed',
        };
  }

  async get(auth: string, id: string) {
    const publisher = await this.publisherFromKey(auth);
    const red = await this.repo.findAttribution(publisher.id, id);
    if (!red) throw new NotFoundException();
    return red;
  }
}

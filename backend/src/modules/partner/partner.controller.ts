/**
 * Partner API: server-to-server only. It answers exactly one question — "is this new user
 * attributable to a campaign?" — and no code path here can grant currency or hand back
 * anything a device could redeem. That separation is the compliance argument.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { REFERRER_WINDOW_DAYS, SIGNUP_WINDOW_DAYS } from '../../config';
import {
  bonusLabel,
  bonusesFor,
  campaignBonuses,
  claimIdFromReferrer,
  codeFromReferrer,
} from '../../common/attribution';
import { recordDecision } from '../../common/obs';
import { splitFee } from '../../common/rates';
import { sha256, str } from '../../common/security';
import { lockedBalance, payout } from '../../database/ledger';
import { Tx, prisma } from '../../database/prisma';
import { orgFromKey } from './api-key';

const publisherFromKey = (auth: string) => orgFromKey(auth, 'publisher');

interface ClaimableScan {
  id: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  bonus_types: string[];
  coin_rate: number;
  guest_rate: number;
  grace_days: number;
  /** basis points of the payout the platform retains, snapshotted on the partnership */
  platform_fee_bps: number;
}

// SKIP LOCKED, not plain FOR UPDATE: a second concurrent claim must come back unattributed
// rather than queue behind the first and then re-process the same row.
const byClaimId = (tx: Tx, publisherId: string, claimId: string) =>
  tx.$queryRaw<ClaimableScan[]>`
    SELECT s.id, s.campaign_id, c.name AS campaign_name, c.status, c.bonus_types,
           p.coin_rate, p.guest_rate, p.grace_days, p.platform_fee_bps
    FROM scans s
    JOIN campaigns c    ON c.id = s.campaign_id
    JOIN partnerships p ON p.id = c.partnership_id
    WHERE s.claim_id = ${claimId}
      AND s.consumed = false
      AND p.publisher_org_id = ${publisherId}::uuid
      AND p.status = 'active'
      AND s.scanned_at > now() - make_interval(days => ${REFERRER_WINDOW_DAYS})
    FOR UPDATE OF s SKIP LOCKED`;

interface Carried {
  claimId: string | null;
  carrier: MatchMethod;
}

type MatchMethod = 'referrer' | 'appclip' | 'pasteboard';
const CARRIERS = ['referrer', 'appclip', 'pasteboard'] as const;

/** Parse and bound the claim half of a request body — it arrives from another company's server.
 *  The old iOS fingerprint fields are ignored rather than rejected, so an un-upgraded SDK
 *  degrades to "no claim carried". */
function readCarried(b: Record<string, unknown>): Carried {
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

type Match =
  | { scan: ClaimableScan; confidence: number; match_method: MatchMethod }
  | { reason: string; confidence?: number };

/** Unattributed, but roll back first: `claimInstall`/`claimAtSignup` flip their guard before the
 *  budget is known, so returning normally would permanently burn an install that came up short. */
class Rollback extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

/** Find the scan this install came from, or refuse. No fallback by design — gone, already claimed
 *  and another publisher's all answer `no_match`. `confidence` is always 100, kept for API
 *  compatibility. */
async function matchScan(tx: Tx, publisherId: string, carried: Carried): Promise<Match> {
  if (!carried.claimId) return { reason: 'no_claim' };
  const rows = await byClaimId(tx, publisherId, carried.claimId);
  return rows[0]
    ? { scan: rows[0], confidence: 100, match_method: carried.carrier }
    : { reason: 'no_match' };
}

/** Signup on the preferred path: matched at first open, so this only checks the install is still
 *  spendable. `redeemed` is flipped inside the `updateMany` that tests it, so two simultaneous
 *  signups are safe. The scan is deliberately not re-matched. */
async function claimInstall(tx: Tx, publisherId: string, installId: string): Promise<Match> {
  // Shape-checked first: `::uuid` throws 22P02 on a malformed value rather than returning empty.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(installId))
    return { reason: 'no_match' };

  const rows = await tx.$queryRaw<
    (ClaimableScan & { install_expired: boolean; confidence: number; match_method: string })[]
  >`
    SELECT s.id, s.campaign_id, c.name AS campaign_name, c.status, c.bonus_types,
           p.coin_rate, p.guest_rate, p.grace_days, p.platform_fee_bps,
           i.confidence, i.match_method, (i.expires_at <= now()) AS install_expired
    FROM installs i
    JOIN scans s        ON s.id = i.scan_id
    JOIN campaigns c    ON c.id = i.campaign_id
    JOIN partnerships p ON p.id = c.partnership_id
    WHERE i.id = ${installId}::uuid
      AND i.publisher_org_id = ${publisherId}::uuid
      AND p.status = 'active'
    FOR UPDATE OF i`;
  const row = rows[0];
  if (!row) return { reason: 'no_match' };
  if (row.install_expired) return { reason: 'install_expired' };
  // Re-checked here, not just at first open: pausing a campaign has to stop spending immediately.
  if (row.status !== 'active') return { reason: 'campaign_not_active' };

  const taken = await tx.install.updateMany({
    where: { id: installId, redeemed: false },
    data: { redeemed: true },
  });
  if (!taken.count) return { reason: 'already_claimed' };

  return {
    scan: row,
    confidence: row.confidence,
    match_method: row.match_method as MatchMethod,
  };
}

interface ClaimableCode {
  qr_code_id: string;
  scan_id: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  bonus_types: string[];
  engagement_rate: number;
  platform_fee_bps: number;
}

/** The engagement path: a code minted against one real purchase, scanned once, paid once.
 *  `scans.consumed` is deliberately not checked — that is the acquisition guard, and both rewards
 *  are payable on one scan. The engagement guarantee is its own partial unique index. */
async function claimCode(tx: Tx, publisherId: string, code: string): Promise<ClaimableCode | { reason: string }> {
  // `FOR UPDATE OF q` serialises two simultaneous claims for one code here, rather than letting
  // both reach the INSERT and relying on the unique index to tell one of them it lost.
  const rows = await tx.$queryRaw<(ClaimableCode & { mode: string })[]>`
    SELECT q.id AS qr_code_id, s.id AS scan_id, c.id AS campaign_id, c.name AS campaign_name,
           c.status, c.mode, c.bonus_types, p.engagement_rate, p.platform_fee_bps
    FROM qr_codes q
    JOIN scans s        ON s.qr_code_id = q.id
    JOIN campaigns c    ON c.id = q.campaign_id
    JOIN partnerships p ON p.id = c.partnership_id
    WHERE q.code = ${code}
      AND NOT q.voided
      AND p.publisher_org_id = ${publisherId}::uuid
      AND p.status = 'active'
      AND s.scanned_at > now() - make_interval(days => ${REFERRER_WINDOW_DAYS})
    ORDER BY s.scanned_at DESC
    LIMIT 1
    FOR UPDATE OF q`;
  const row = rows[0];
  // Four situations share one answer on purpose — unknown code, voided, another publisher's, and
  // one nobody has scanned. Telling them apart would let a publisher probe the whole platform.
  if (!row) return { reason: 'no_match' };
  if (row.mode !== 'engagement') return { reason: 'not_engagement' };
  if (row.status !== 'active') return { reason: 'campaign_not_active' };
  return row;
}

/** Legacy single-call path: match and pay in one request, no install row. Same deterministic
 *  lookup, kept for publishers already integrated. */
async function claimAtSignup(tx: Tx, publisherId: string, carried: Carried): Promise<Match> {
  const m = await matchScan(tx, publisherId, carried);
  if ('reason' in m) return m;
  if (m.scan.status !== 'active') return { reason: 'campaign_not_active' };

  // No install row to guard with, so the scan itself is the guard — same atomic test-and-set.
  const consumed = await tx.scan.updateMany({
    where: { id: m.scan.id, consumed: false },
    data: { consumed: true },
  });
  if (!consumed.count) return { reason: 'already_claimed' };
  return m;
}

@ApiTags('Partner API')
@ApiBearerAuth('apiKey')
@Controller('v1/attribution')
export class PartnerController {
  /**
   * Stage one: first app open. Nothing is paid here. The claim id is readable only at launch — an
   * App Clip's container is migrated once, the pasteboard holds one thing — but signup is
   * routinely the next day, so this consumes the scan and returns an `install_id` the SDK must
   * persist. A second call finds the scan consumed and answers `no_match`.
   */
  @Post('first-open')
  @HttpCode(200)
  async firstOpen(
    @Headers('authorization') auth: string,
    @Body()
    b: {
      /** raw string from Play's Install Referrer API — Android */
      install_referrer?: string;
      /** the claim id alone: what the App Clip container or the pasteboard handed the app */
      claim_id?: string;
      /** `referrer` | `appclip` | `pasteboard`. Reporting only; inferred when absent. */
      carrier?: string;
      /** device integrity, as asserted by the SDK */
      emulator?: boolean;
      rooted?: boolean;
      vpn?: boolean;
    },
  ) {
    const publisher = await publisherFromKey(auth);
    // Refusals carry the publisher's whole signup offer; an attributed answer carries the
    // campaign's own pick.
    const bonuses = bonusesFor(publisher.bonuses, 'acquisition');
    const carried = readCarried(b as Record<string, unknown>);
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

    const outcome = await prisma.$transaction(async (tx) => {
      const m = await matchScan(tx, publisher.id, carried);
      if ('reason' in m) return { attributed: false, reason: m.reason, confidence: m.confidence };
      const { scan, confidence, match_method } = m;
      if (scan.status !== 'active') return { attributed: false, reason: 'campaign_not_active' };

      // Bind nothing against a campaign that cannot pay: the signup would fail on budget anyway
      // and would have burned the scan getting there.
      if ((await lockedBalance(tx, `campaign:${scan.campaign_id}`)) < scan.guest_rate)
        return { attributed: false, reason: 'budget_exhausted' };

      // One install per scan, independent of the matcher's lock rather than a consequence of it.
      const consumed = await tx.scan.updateMany({
        where: { id: scan.id, consumed: false },
        data: { consumed: true },
      });
      if (!consumed.count) return { attributed: false, reason: 'already_claimed' };

      const expires_at = new Date(Date.now() + SIGNUP_WINDOW_DAYS * 86_400_000);
      const install = await tx.install.create({
        data: {
          scan_id: scan.id,
          campaign_id: scan.campaign_id,
          publisher_org_id: publisher.id,
          match_method,
          confidence,
          risk,
          expires_at,
        },
        select: { id: true },
      });

      // What *this campaign* advertises, not everything the publisher runs — the artwork was
      // printed off these.
      const granted = campaignBonuses(publisher.bonuses, 'acquisition', scan.bonus_types);

      return {
        attributed: true,
        /** present this at signup. Not a credential and not spendable — it names an install. */
        install_id: install.id,
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
    });

    // One record per first-open, refused or bound: a misconfigured store target produces no
    // errors and writes no rows, so this series is the only symptom.
    recordDecision(
      'first_open',
      {
        reason: outcome.attributed ? undefined : outcome.reason,
        match_method: outcome.match_method,
        confidence: outcome.confidence,
      },
      { publisher_org_id: publisher.id, campaign_id: outcome.campaign_id },
    );
    return outcome;
  }

  /**
   * Stage two: a new user finished signing up, so the fee is earned. Preferred shape is
   * `{ install_id, publisher_user_ref }`; the carrier fields are the legacy single-call shape,
   * whose only cost is that a signup that never happens leaves the scan claimable.
   *
   * Unattributed is a normal answer — most installs are organic — so a 200, not an error.
   */
  @Post('claim')
  @HttpCode(200)
  async claim(
    @Headers('authorization') auth: string,
    @Body()
    b: {
      publisher_user_ref: string;
      /** preferred: the id `first-open` returned for this device */
      install_id?: string;
      /** legacy single-call shape: raw string from Play's Install Referrer API */
      install_referrer?: string;
      /** legacy single-call shape: the claim id alone, as the SDK stored it */
      claim_id?: string;
      /** legacy single-call shape: which carrier produced it */
      carrier?: string;
      /** The engagement path: a transaction code the promoter minted, bare or as the whole
       *  referrer. Explicit, never read out of `install_referrer` — different payouts, different
       *  terms. */
      code?: string;
      /** The publisher asserting this account is brand-new. Only `false` acts, so older
       *  integrations are unaffected. */
      is_new_user?: boolean;
      /** the publisher asserting this user cleared its own verification bar */
      identified?: boolean;
    },
  ) {
    const publisher = await publisherFromKey(auth);
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

    const carried = install_id ? null : readCarried(b as Record<string, unknown>);
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

    // Set when the UNIQUE below fires: no query can run inside an aborted Postgres transaction.
    let replayCampaignId: string | null = null;

    const fresh = await prisma.$transaction(async (tx) => {
      const resolved = install_id
        ? await claimInstall(tx, publisher.id, install_id)
        : await claimAtSignup(tx, publisher.id, carried!);
      if ('reason' in resolved) return unattributed(resolved.reason);
      const { scan, confidence, match_method } = resolved;

      const identified = b.identified === true;
      const fee = identified ? scan.coin_rate : scan.guest_rate;

      // Fail closed, thrown rather than returned so the install/scan is released — see `Rollback`.
      // Unattributed rather than an error: the user has already signed up.
      if ((await lockedBalance(tx, `campaign:${scan.campaign_id}`)) < fee)
        throw new Rollback('budget_exhausted');

      let red;
      try {
        red = await tx.redemption.create({
          data: {
            campaign_id: scan.campaign_id,
            scan_id: scan.id,
            install_id,
            publisher_user_ref,
            coins: fee,
            identified,
            match_method,
            confidence,
          },
          select: { id: true },
        });
      } catch (e: any) {
        // UNIQUE (campaign_id, publisher_user_ref): already counted. Roll back so the scan is not
        // left consumed, and answer from the existing row.
        if (e.code === 'P2002') {
          replayCampaignId = scan.campaign_id;
          throw new ConflictException('duplicate_user');
        }
        throw e;
      }

      const ref = `redemption:${red.id}`;
      const { net, cut } = await payout(
        tx, scan.campaign_id, publisher.id, fee, scan.platform_fee_bps, ref,
      );

      recordDecision(
        'claim',
        { match_method, confidence },
        {
          publisher_org_id: publisher.id,
          campaign_id: scan.campaign_id,
          attribution_id: red.id,
          fee,
          platform_fee: cut,
          identified,
        },
      );

      const granted = campaignBonuses(publisher.bonuses, 'acquisition', scan.bonus_types);

      return {
        attributed: true,
        attribution_id: red.id,
        campaign_id: scan.campaign_id,
        campaign_name: scan.campaign_name,
        match_method,
        confidence,
        identified,
        /** gross marketing fee, in platform credits — what the campaign budget spent. */
        fee,
        /** what actually landed in the publisher's account: fee minus the platform's cut */
        publisher_net: net,
        platform_fee: cut,
        pending_fee: identified ? 0 : scan.coin_rate - scan.guest_rate,
        confirm_deadline: identified
          ? null
          : new Date(Date.now() + scan.grace_days * 86_400_000).toISOString(),
        /** the offers this campaign advertises. A description, never an instruction. */
        bonuses: granted,
        bonus_label: bonusLabel(granted),
        /** false on the first answer for this user; see the replay note on retries. */
        replay: false,
      };
    }).catch((e) => {
      // Rolled back on purpose; the caller still gets a 200 and the install stays claimable.
      if (e instanceof Rollback) return unattributed(e.reason);
      if (replayCampaignId) return null; // handled below, as a replay rather than an error
      throw e;
    });
    if (fresh) return fresh;

    /** Replay: already attributed, which in practice means the first call succeeded and its
     *  response was lost. A 409 would make a correct attribution look like something to reconcile
     *  by hand, so the original answer is replayed verbatim. */
    const prior = await prisma.redemption.findFirst({
      // `kind` matches the PARTIAL unique index's predicate — without it Postgres cannot prove
      // the index applies, and an unscoped findFirst can hand back the engagement row for a user
      // who has both, which is a different fee and a /confirm that answers `already_full`.
      where: { campaign_id: replayCampaignId!, publisher_user_ref, kind: 'acquisition' },
      include: { campaign: { select: { name: true, bonus_types: true, partnership: { select: { coin_rate: true, grace_days: true, platform_fee_bps: true } } } } },
    });
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

  /**
   * The engagement payout: a repeat purchase, paid on the code that proves it happened.
   *
   * Not routed through the acquisition machinery — that is all device recognition, which has no
   * question to answer here. It shares the budget lock, ledger, rollback-on-refusal and
   * replay-never-re-pay. No guest tier: a repeat customer already transacted with the promoter.
   */
  private async claimPurchase(
    publisher: { id: string; bonuses: unknown },
    code: string,
    publisher_user_ref: string,
  ) {
    const bonuses = bonusesFor(publisher.bonuses, 'engagement');
    const unattributed = (reason: string) => {
      recordDecision('claim', { reason, match_method: 'code' }, { publisher_org_id: publisher.id });
      return { attributed: false, reason, bonuses, bonus_label: bonusLabel(bonuses) };
    };

    let replayQrCodeId: string | null = null;

    const fresh = await prisma
      .$transaction(async (tx) => {
        const m = await claimCode(tx, publisher.id, code);
        if ('reason' in m) return unattributed(m.reason);

        const fee = m.engagement_rate;
        // Fail closed, thrown so the whole transaction is undone and the code stays claimable.
        if ((await lockedBalance(tx, `campaign:${m.campaign_id}`)) < fee)
          throw new Rollback('budget_exhausted');

        let red;
        try {
          red = await tx.redemption.create({
            data: {
              campaign_id: m.campaign_id,
              scan_id: m.scan_id,
              qr_code_id: m.qr_code_id,
              publisher_user_ref,
              coins: fee,
              kind: 'engagement',
              // Settled the moment it is written: nothing is held back for `/confirm` to release.
              identified: true,
              match_method: 'code',
              confidence: 100,
            },
            select: { id: true },
          });
        } catch (e: any) {
          // UNIQUE (qr_code_id) WHERE kind = 'engagement': this code has already been rewarded.
          if (e.code === 'P2002') {
            replayQrCodeId = m.qr_code_id;
            throw new ConflictException('already_claimed');
          }
          throw e;
        }

        const ref = `redemption:${red.id}`;
        const { net, cut } = await payout(
          tx, m.campaign_id, publisher.id, fee, m.platform_fee_bps, ref,
        );

        recordDecision(
          'claim',
          { match_method: 'code', confidence: 100 },
          {
            publisher_org_id: publisher.id,
            campaign_id: m.campaign_id,
            attribution_id: red.id,
            fee,
            platform_fee: cut,
            kind: 'engagement',
          },
        );

        const granted = campaignBonuses(publisher.bonuses, 'engagement', m.bonus_types);

        return {
          attributed: true,
          attribution_id: red.id,
          campaign_id: m.campaign_id,
          campaign_name: m.campaign_name,
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
      })
      .catch((e) => {
        if (e instanceof Rollback) return unattributed(e.reason);
        if (replayQrCodeId) return null; // handled below, as a replay rather than an error
        throw e;
      });
    if (fresh) return fresh;

    const prior = await prisma.redemption.findFirst({
      where: { qr_code_id: replayQrCodeId!, kind: 'engagement' },
      include: { campaign: { select: { name: true, bonus_types: true, partnership: { select: { platform_fee_bps: true } } } } },
    });
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

  /**
   * Second leg: the user cleared the publisher's verification bar inside the grace period,
   * so the held-back part of the fee is released. Idempotent — a second call is a no-op.
   */
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(@Headers('authorization') auth: string, @Param('id') id: string) {
    const publisher = await publisherFromKey(auth);
    return prisma.$transaction(async (tx) => {
      // Raw because `FOR UPDATE OF rd` locks the attribution row across the join, and that lock
      // is what makes a concurrent double-confirm safe.
      const rows = await tx.$queryRaw<
        {
          id: string;
          coins: number;
          identified: boolean;
          created_at: Date;
          campaign_id: string;
          coin_rate: number;
          grace_days: number;
          platform_fee_bps: number;
          partnership_status: string;
        }[]
      >`
        SELECT rd.id, rd.coins, rd.identified, rd.created_at, rd.campaign_id,
               p.coin_rate, p.grace_days, p.platform_fee_bps, p.status AS partnership_status
        FROM redemptions rd
        JOIN campaigns c ON c.id = rd.campaign_id
        JOIN partnerships p ON p.id = c.partnership_id
        WHERE rd.id = ${id}::uuid AND p.publisher_org_id = ${publisher.id}::uuid
        FOR UPDATE OF rd`;
      const red = rows[0];
      if (!red) throw new NotFoundException('attribution not found');
      // Suspending a partnership must stop payouts too; every other spend filters on it in SQL.
      // Surfaced as a reason rather than filtered out, so it does not read like a lost attribution.
      if (red.partnership_status !== 'active')
        throw new ConflictException('partnership_not_active');
      if (red.identified)
        return { attribution_id: red.id, fee: red.coins, identified: true, status: 'already_full' };

      const deadline = new Date(red.created_at).getTime() + red.grace_days * 86_400_000;
      if (Date.now() > deadline) throw new ConflictException('grace_period_expired');

      const delta = red.coin_rate - red.coins;
      if (delta > 0) {
        if ((await lockedBalance(tx, `campaign:${red.campaign_id}`)) < delta)
          throw new ConflictException('budget_exhausted');
        // Same split as the guest payment, so the cut is taken on the whole coin_rate.
        await payout(tx, red.campaign_id, publisher.id, delta, red.platform_fee_bps, `upgrade:${red.id}`);
      }
      await tx.redemption.update({
        where: { id: red.id },
        data: { coins: red.coin_rate, identified: true, upgraded_at: new Date() },
      });
      return {
        attribution_id: red.id,
        fee: red.coin_rate,
        fee_added: delta,
        identified: true,
        status: 'confirmed',
      };
    });
  }

  @Get(':id')
  async get(@Headers('authorization') auth: string, @Param('id') id: string) {
    const publisher = await publisherFromKey(auth);
    const red = await prisma.redemption.findFirst({
      where: { id, campaign: { partnership: { publisher_org_id: publisher.id } } },
    });
    if (!red) throw new NotFoundException();
    return red;
  }
}

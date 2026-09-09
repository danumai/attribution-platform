import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { allBonuses, campaignBonuses, scanUrl, validateBonusTypes } from '../../common/attribution';
import { toBonuses } from '../../common/dto/bonus.dto';
import { validateStyle } from '../../common/qr';
import { splitFee, validateRates } from '../../common/rates';
import { sha256 } from '../../common/security';
import { ALLOW_SELF_FUNDING, BASE_URL, PLATFORM_FEE_BPS } from '../../config';
import { SessionClaims, newApiKey, newShortCode } from '../auth/tokens';
import {
  CreateCampaignDto,
  CreateQrCodeDto,
  FundCampaignDto,
  PatchCampaignDto,
  PatchOrgDto,
  ProposeRatesDto,
  RequestPartnershipDto,
  RequestWithdrawalDto,
  RestyleQrCodeDto,
} from './dto/bodies.dto';
import { CampaignPatch, OrgPatch, PortalRepository, RateProposal } from './portal.repository';

const CLEARED_PROPOSAL: RateProposal = {
  proposed_coin_rate: null,
  proposed_guest_rate: null,
  proposed_engagement_rate: null,
};

/**
 * What the tenant portal *means*, on top of what the repository reads and writes: which of the
 * two roles may do a thing, which side of a partnership a session is on, the rate and reward
 * rules that need the stored row, the response shapes both consoles render, and the audit record
 * every tenant action leaves in the admin's inbox.
 *
 * Every method takes the session rather than an org id, because org scoping *is* the boundary
 * here — unlike the admin module, where the guard is the whole of it.
 */
@Injectable()
export class PortalService {
  constructor(private readonly repo: PortalRepository) {}

  // ------------------------------------------------------------------------------- publishers

  /**
   * `ready` is what a promoter needs before committing a print run: a publisher with no store
   * listing and no web fallback has nowhere to send a scan.
   */
  async publishers() {
    const rows = await this.repo.listPublishers();
    return rows.map(({ landing_url, android_package, ios_app_id, bonuses, ...o }) => ({
      ...o,
      bonuses: allBonuses(bonuses),
      ready: Boolean(landing_url || android_package || ios_app_id),
    }));
  }

  // ------------------------------------------------------------------------------ partnerships

  async requestPartnership(s: SessionClaims, dto: RequestPartnershipDto) {
    if (s.type !== 'promoter') throw new ForbiddenException('promoters only');
    if (!(await this.repo.findEligiblePublisher(dto.publisher_org_id)))
      throw new BadRequestException('no such publisher');
    // No `current` row to resolve against: a new partnership takes the platform defaults for
    // anything left out, by the same rules the admin patch runs.
    const rates = validateRates(dto);
    const created = await this.repo.createPartnership({
      promoter_org_id: s.org_id,
      publisher_org_id: dto.publisher_org_id,
      ...rates,
      // Snapshotted, not read live at payout: changing the platform default must never silently
      // reprice a deal both parties already agreed to.
      platform_fee_bps: PLATFORM_FEE_BPS,
    });
    await this.repo.audit(s.org_id, 'partnership.create', `partnership:${created.id}`, {
      publisher_org_id: dto.publisher_org_id,
      ...rates,
    });
    return created;
  }

  async listPartnerships(s: SessionClaims, limit: number) {
    const rows = await this.repo.listPartnerships(s.org_id, limit);
    return rows.map(({ promoter, publisher, ...p }) => ({
      ...p,
      promoter_name: promoter.name,
      publisher_name: publisher.name,
      // Read live off the publisher rather than snapshotted at agreement — the offer is the
      // publisher's own to change, and the promoter needs to see what a scanner gets today.
      publisher_bonuses: allBonuses(publisher.bonuses),
    }));
  }

  async accept(s: SessionClaims, id: string) {
    if (!(await this.repo.acceptPartnership(id, s.org_id))) throw new NotFoundException();
    await this.repo.audit(s.org_id, 'partnership.accept', `partnership:${id}`);
    return this.repo.findPartnership(id);
  }

  /**
   * Ask to reprice a live partnership. A request, not a change: the coin rate is what the
   * *publisher* is paid, and the money must not stop while the two sides talk, so the proposal
   * lands in its own columns.
   */
  async proposeRates(s: SessionClaims, id: string, dto: ProposeRatesDto) {
    const current = await this.repo.findActivePartnershipAsPromoter(id, s.org_id);
    if (!current) throw new NotFoundException('no active partnership with that id');
    // Resolved against the row, so the pair rule is judged on the post-accept numbers: moving
    // only the coin rate still has to clear the guest rate already in force.
    const { coin_rate, guest_rate, engagement_rate } = validateRates(dto, current);
    if (
      coin_rate === current.coin_rate &&
      guest_rate === current.guest_rate &&
      engagement_rate === current.engagement_rate
    )
      throw new BadRequestException('those are the rates already in force');
    // Written as a set even when only one moved: the proposal columns are all-or-nothing, and a
    // publisher accepting must see every number it is agreeing to, not a delta.
    const updated = await this.repo.updateProposal(id, {
      proposed_coin_rate: coin_rate,
      proposed_guest_rate: guest_rate,
      proposed_engagement_rate: engagement_rate,
    });
    await this.repo.audit(s.org_id, 'partnership.rates.propose', `partnership:${id}`, {
      from: {
        coin_rate: current.coin_rate,
        guest_rate: current.guest_rate,
        engagement_rate: current.engagement_rate,
      },
      to: { coin_rate, guest_rate, engagement_rate },
    });
    return updated;
  }

  /** Declining clears the proposal and leaves the agreed rates alone — the promoter can ask again. */
  async decideRates(s: SessionClaims, id: string, accept: boolean) {
    const p = await this.repo.findOpenProposal(id, s.org_id);
    if (!p) throw new NotFoundException('no open rate proposal');
    const expected: RateProposal = {
      proposed_coin_rate: p.proposed_coin_rate,
      proposed_guest_rate: p.proposed_guest_rate,
      proposed_engagement_rate: p.proposed_engagement_rate,
    };
    const applied = await this.repo.decideRates(
      id,
      expected,
      accept
        ? {
            coin_rate: p.proposed_coin_rate!,
            guest_rate: p.proposed_guest_rate!,
            engagement_rate: p.proposed_engagement_rate!,
            ...CLEARED_PROPOSAL,
          }
        : CLEARED_PROPOSAL,
    );
    if (!applied)
      throw new BadRequestException('the proposal changed — reload and look again');
    await this.repo.audit(
      s.org_id,
      `partnership.rates.${accept ? 'accept' : 'decline'}`,
      `partnership:${id}`,
      {
        coin_rate: p.proposed_coin_rate,
        guest_rate: p.proposed_guest_rate,
        engagement_rate: p.proposed_engagement_rate,
      },
    );
    return this.repo.findPartnership(id);
  }

  // --------------------------------------------------------------------------------- campaigns

  async createCampaign(s: SessionClaims, dto: CreateCampaignDto) {
    const mode = dto.mode ?? 'acquisition';
    const partnership = await this.repo.findActivePartnershipForCampaign(
      dto.partnership_id,
      s.org_id,
    );
    if (!partnership) throw new BadRequestException('no active partnership with that id');
    // Which of the publisher's own offers this campaign advertises, checked against what that
    // publisher grants for this mode — the artwork is printed off this.
    const bonus_types = validateBonusTypes(
      dto.bonus_types,
      campaignBonuses(partnership.publisher.bonuses, mode),
    );
    const created = await this.repo.createCampaign({
      partnership_id: dto.partnership_id,
      name: dto.name,
      mode,
      bonus_types,
    });
    await this.repo.audit(s.org_id, 'campaign.create', `campaign:${created.id}`, {
      name: dto.name,
      mode,
      bonus_types,
      partnership_id: dto.partnership_id,
    });
    return created;
  }

  async listCampaigns(s: SessionClaims, limit: number) {
    const rows = await this.repo.listCampaigns(s.org_id, limit);
    const budgets = await this.repo.balances(rows.map((c) => `campaign:${c.id}`));
    return rows.map(({ partnership, ...c }) => ({
      ...c,
      coin_rate: partnership.coin_rate,
      engagement_rate: partnership.engagement_rate,
      promoter_name: partnership.promoter.name,
      publisher_name: partnership.publisher.name,
      // What this campaign promises, resolved against the publisher's list as it stands today.
      // Both sides read the same line.
      publisher_bonuses: campaignBonuses(partnership.publisher.bonuses, c.mode, c.bonus_types),
      budget: budgets.get(`campaign:${c.id}`) ?? 0,
    }));
  }

  /** Either party may read a campaign; only the promoter may change it. */
  private async ownedCampaign(orgId: string, campaignId: string) {
    const c = await this.repo.findOwnedCampaign(orgId, campaignId);
    if (!c) throw new NotFoundException('campaign not found');
    return c;
  }

  private async promoterCampaign(orgId: string, campaignId: string) {
    const c = await this.ownedCampaign(orgId, campaignId);
    if (c.partnership.promoter_org_id !== orgId) throw new ForbiddenException();
    return c;
  }

  /**
   * Demo funding: credits the budget with no payment behind it, so it is off in production —
   * left on, any promoter mints the budget that pays publishers.
   */
  async fund(s: SessionClaims, id: string, dto: FundCampaignDto) {
    if (!ALLOW_SELF_FUNDING)
      throw new ForbiddenException('direct funding is disabled — fund through checkout');
    await this.promoterCampaign(s.org_id, id);
    await this.repo.fundCampaign(id, dto.coins, dto.idempotency_key);
    // Money entered without a payment record, so the ledger alone does not say who asked for it.
    // Also the admin's notification, which is why it carries the resulting budget.
    const budget = await this.repo.balance(`campaign:${id}`);
    await this.repo.audit(s.org_id, 'campaign.fund', `campaign:${id}`, { coins: dto.coins, budget });
    return { budget };
  }

  async patchCampaign(s: SessionClaims, id: string, dto: PatchCampaignDto) {
    const c = await this.promoterCampaign(s.org_id, id);
    // Keyed on what was *sent*, so a rename need not restate the status and quietly reactivate an
    // ended campaign — and `bonus_types: []` still clears the pick.
    const data: CampaignPatch = {
      ...(dto.name === undefined ? {} : { name: dto.name }),
      ...(dto.bonus_types === undefined
        ? {}
        : {
            bonus_types: validateBonusTypes(
              dto.bonus_types,
              campaignBonuses(c.partnership.publisher.bonuses, c.mode),
            ),
          }),
      ...(dto.status === undefined ? {} : { status: dto.status }),
    };
    if (!Object.keys(data).length) throw new BadRequestException('nothing to update');
    const updated = await this.repo.updateCampaign(id, data);
    // Audited because it is a tenant changing something the platform is answerable for, and the
    // admin's inbox is built out of exactly those entries.
    await this.repo.audit(s.org_id, 'campaign.patch', `campaign:${id}`, data);
    return updated;
  }

  async stats(s: SessionClaims, id: string) {
    const c = await this.ownedCampaign(s.org_id, id);
    const [scans, reds, budget_remaining] = await this.repo.campaignTotals(id);
    return {
      name: c.name,
      status: c.status,
      scans,
      redemptions: reds._count,
      coins_granted: reds._sum.coins ?? 0,
      budget_remaining,
      // A poster on an engagement campaign cannot promise the signup offer, and one selling
      // coins does not also promise the free month.
      publisher_bonuses: campaignBonuses(c.partnership.publisher.bonuses, c.mode, c.bonus_types),
    };
  }

  /** Where this campaign's scans came from. Read-only for both sides. */
  async analytics(s: SessionClaims, id: string, days: number) {
    await this.ownedCampaign(s.org_id, id);
    return this.repo.scanAnalytics(id, days);
  }

  // ---------------------------------------------------------------------------------- qr codes

  async createQr(s: SessionClaims, id: string, dto: CreateQrCodeDto) {
    await this.promoterCampaign(s.org_id, id);
    const style = validateStyle(dto.style ?? {});
    const days = dto.expires_in_days ?? 30;
    const qr = await this.repo.createQrCode({
      campaign_id: id,
      code: newShortCode(),
      style: style as object,
      expires_at: days === 0 ? null : new Date(Date.now() + days * 86_400_000),
      max_uses: dto.max_uses ?? null,
    });
    return { ...qr, scan_url: scanUrl(BASE_URL, qr.code, await this.repo.publisherSlug(id)) };
  }

  /**
   * Promoters can kill their own code (lost or stolen print run) but cannot extend its life —
   * loosening a limit is an admin override so it lands in the audit log.
   */
  async voidQr(s: SessionClaims, id: string) {
    const qr = await this.updateOwnQr(s.org_id, id, { voided: true });
    // Killing a code is the one QR action worth an admin's attention: a print run just stopped
    // working, and the support call arrives before anyone checks a log.
    await this.repo.audit(s.org_id, 'qr_code.void', `qr_code:${id}`, { code: qr?.code });
    return qr;
  }

  restyleQr(s: SessionClaims, id: string, dto: RestyleQrCodeDto) {
    return this.updateOwnQr(s.org_id, id, { style: validateStyle(dto.style ?? {}) as object });
  }

  private async updateOwnQr(orgId: string, id: string, data: { voided?: boolean; style?: object }) {
    if (!(await this.repo.updateOwnQrCode(orgId, id, data))) throw new NotFoundException();
    return this.repo.findQrCode(id);
  }

  async listQr(s: SessionClaims, id: string, limit: number) {
    await this.ownedCampaign(s.org_id, id);
    const rows = await this.repo.listQrCodes(id, limit);
    // One lookup for the page rather than one per code: every QR on a campaign points at the
    // same publisher.
    const slug = await this.repo.publisherSlug(id);
    return rows.map((q) => ({ ...q, scan_url: scanUrl(BASE_URL, q.code, slug) }));
  }

  // -------------------------------------------------------------------------------------- orgs

  /**
   * Both machine callers rotate their key here: a publisher's earns fees on
   * `/v1/attribution/*`, a promoter's mints codes on `/v1/issue`. Same credential, same
   * one-call revocation.
   */
  async rotateKey(s: SessionClaims) {
    if (s.type === 'admin') throw new ForbiddenException('tenants only');
    const api_key = newApiKey();
    await this.repo.setApiKeyHash(s.org_id, sha256(api_key));
    // The old key stops earning fees the moment this lands, so a publisher whose attribution
    // calls start 401ing is usually this event. Never the key itself, only that it happened.
    await this.repo.audit(s.org_id, 'org.rotate_key', `org:${s.org_id}`);
    return { api_key };
  }

  async me(s: SessionClaims) {
    const org = await this.repo.findOrg(s.org_id);
    // Every fee a publisher has earned lands in `publisher:{org_id}`. `withdrawableNow` is the
    // slice of it that has cleared the settlement window and is not already queued.
    return org.type === 'publisher'
      ? {
          ...org,
          earnings: await this.repo.balance(`publisher:${org.id}`),
          withdrawable: await this.repo.withdrawableNow(org.id),
        }
      : org;
  }

  /**
   * Publishers only — these are the fields the scan redirect reads off the *publisher* side of a
   * partnership.
   */
  async patchOrg(s: SessionClaims, dto: PatchOrgDto) {
    if (s.type !== 'publisher') throw new ForbiddenException('publishers only');
    // Keyed on whether the key was *sent*, not on the value: every property normalises a blank to
    // null, so keying on the value made clearing a field impossible. The distinction is
    // `undefined` vs `null` — see the note on PatchOrgDto in the admin module.
    const data: OrgPatch = {
      ...(dto.landing_url === undefined ? {} : { landing_url: dto.landing_url }),
      ...(dto.android_package === undefined ? {} : { android_package: dto.android_package }),
      ...(dto.ios_app_id === undefined ? {} : { ios_app_id: dto.ios_app_id }),
      ...(dto.ios_appclip_id === undefined ? {} : { ios_appclip_id: dto.ios_appclip_id }),
      ...(dto.slug === undefined ? {} : { slug: dto.slug }),
      ...(dto.ios_provider_token === undefined
        ? {}
        : { ios_provider_token: dto.ios_provider_token }),
      ...(dto.deeplink_url === undefined ? {} : { deeplink_url: dto.deeplink_url }),
      ...(dto.bonuses === undefined ? {} : { bonuses: toBonuses(dto.bonuses) }),
    };

    // Checked against what the org will hold *after* this patch, not the body alone, so setting
    // one field today and the other tomorrow works — and clearing one alone is refused too.
    const current = await this.repo.findClipRegistration(s.org_id);
    const after = {
      slug: dto.slug === undefined ? current.slug : dto.slug,
      ios_appclip_id:
        dto.ios_appclip_id === undefined ? current.ios_appclip_id : dto.ios_appclip_id,
    };
    if (Boolean(after.slug) !== Boolean(after.ios_appclip_id))
      throw new BadRequestException(
        'slug and ios_appclip_id must be set together — one without the other registers an App Clip URL that nothing answers to',
      );
    // A promoter's whole print run follows these fields, and `slug` is baked into printed QR
    // codes — changing it orphans every code already in the world.
    const updated = await this.repo.patchOrg(s.org_id, data);
    // After the write: an entry for a change that was rejected is an inbox item about something
    // that never happened.
    await this.repo.audit(s.org_id, 'org.patch', `org:${s.org_id}`, data);
    return updated;
  }

  // ------------------------------------------------------------------------------- withdrawals

  /**
   * Ask for earned fees to be paid out. A request, not a transfer: the ledger only moves when an
   * admin pays it, capped at what has cleared the clawback window.
   */
  async requestWithdrawal(s: SessionClaims, dto: RequestWithdrawalDto) {
    if (s.type !== 'publisher') throw new ForbiddenException('publishers only');
    const created = await this.repo.createWithdrawal(s.org_id, dto.coins);
    // Tenant actor, so it lands in the admin inbox — a payout request must be seen before it
    // goes stale.
    await this.repo.audit(s.org_id, 'withdrawal.request', `withdrawal:${created.id}`, {
      coins: dto.coins,
    });
    return created;
  }

  listWithdrawals(s: SessionClaims, limit: number) {
    if (s.type !== 'publisher') throw new ForbiddenException('publishers only');
    return this.repo.listWithdrawals(s.org_id, limit);
  }

  // ------------------------------------------------------------------------------- redemptions

  async redemptions(s: SessionClaims, limit: number) {
    const rows = await this.repo.listRedemptions(s.org_id, limit);
    // The integration guide tells publishers to book revenue on `publisher_net`, and `coins` is
    // the gross, so a publisher summing it over-reports by the platform's cut on every row.
    // Recomputed through the same `splitFee` the payout used, so the two cannot drift.
    return rows.map(({ campaign, ...r }) => {
      const { net, cut } = splitFee(r.coins, campaign.partnership.platform_fee_bps);
      return {
        ...r,
        campaign_name: campaign.name,
        /** gross — what the promoter's campaign budget spent on this row */
        fee: r.coins,
        /** what actually landed in the publisher's account */
        publisher_net: net,
        platform_fee: cut,
      };
    });
  }
}

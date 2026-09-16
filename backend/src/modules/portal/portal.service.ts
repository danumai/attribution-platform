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
 * Portal policy: role checks, rate/reward rules, response shapes, audit entries. Methods take
 * the session rather than an org id because org scoping *is* the boundary here.
 */
@Injectable()
export class PortalService {
  constructor(private readonly repo: PortalRepository) {}

  // ------------------------------------------------------------------------------- publishers

  // `ready`: a publisher with no store listing and no web fallback has nowhere to send a scan,
  // so a promoter must not commit a print run to it.
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
    // No `current` row: omitted rates take the platform defaults.
    const rates = validateRates(dto);
    const created = await this.repo.createPartnership({
      promoter_org_id: s.org_id,
      publisher_org_id: dto.publisher_org_id,
      ...rates,
      // Snapshotted, not read live at payout: moving the default must not reprice agreed deals.
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
      // Live, not snapshotted: the offer is the publisher's to change, and the promoter needs
      // to see what a scanner gets today.
      publisher_bonuses: allBonuses(publisher.bonuses),
    }));
  }

  async accept(s: SessionClaims, id: string) {
    if (!(await this.repo.acceptPartnership(id, s.org_id))) throw new NotFoundException();
    await this.repo.audit(s.org_id, 'partnership.accept', `partnership:${id}`);
    return this.repo.findPartnership(id);
  }

  /**
   * A request, not a change: the coin rate is what the publisher is paid, so the proposal lands
   * in its own columns and the money keeps moving while the two sides talk.
   */
  async proposeRates(s: SessionClaims, id: string, dto: ProposeRatesDto) {
    const current = await this.repo.findActivePartnershipAsPromoter(id, s.org_id);
    if (!current) throw new NotFoundException('no active partnership with that id');
    // Resolved against the row so the pair rule is judged on post-accept numbers: moving only
    // the coin rate still has to clear the guest rate already in force.
    const { coin_rate, guest_rate, engagement_rate } = validateRates(dto, current);
    if (
      coin_rate === current.coin_rate &&
      guest_rate === current.guest_rate &&
      engagement_rate === current.engagement_rate
    )
      throw new BadRequestException('those are the rates already in force');
    // Written as a set even when one moved: the publisher accepts numbers, not a delta.
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
    // Checked against what the publisher grants for this mode — the artwork is printed off this.
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
      // Resolved against the publisher's list as it stands today; both sides read the same line.
      publisher_bonuses: campaignBonuses(partnership.publisher.bonuses, c.mode, c.bonus_types),
      budget: budgets.get(`campaign:${c.id}`) ?? 0,
    }));
  }

  // Either party may read a campaign; only the promoter may change it.
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
   * Demo funding: credits the budget with no payment behind it, so it must stay off in
   * production — otherwise any promoter mints the budget that pays publishers.
   */
  async fund(s: SessionClaims, id: string, dto: FundCampaignDto) {
    if (!ALLOW_SELF_FUNDING)
      throw new ForbiddenException('direct funding is disabled — fund through checkout');
    await this.promoterCampaign(s.org_id, id);
    await this.repo.fundCampaign(id, dto.coins, dto.idempotency_key);
    // No payment record, so the ledger alone does not say who asked; carries the budget because
    // this is also the admin's notification.
    const budget = await this.repo.balance(`campaign:${id}`);
    await this.repo.audit(s.org_id, 'campaign.fund', `campaign:${id}`, { coins: dto.coins, budget });
    return { budget };
  }

  async patchCampaign(s: SessionClaims, id: string, dto: PatchCampaignDto) {
    const c = await this.promoterCampaign(s.org_id, id);
    // Keyed on what was *sent*: a rename must not restate status and reactivate an ended
    // campaign, while `bonus_types: []` still clears the pick.
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
    // Tenant changing something the platform answers for; the admin inbox is built from these.
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
      // Mode-filtered: an engagement campaign cannot promise the signup offer.
      publisher_bonuses: campaignBonuses(c.partnership.publisher.bonuses, c.mode, c.bonus_types),
    };
  }

  // Where this campaign's scans came from. Read-only for both sides.
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
   * Promoters may kill their own code (lost or stolen print run) but never extend its life —
   * loosening a limit is an admin override.
   */
  async voidQr(s: SessionClaims, id: string) {
    const qr = await this.updateOwnQr(s.org_id, id, { voided: true });
    // The one QR action worth an admin's attention: a print run just stopped working, and the
    // support call arrives before anyone checks a log.
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
    // One lookup per page, not per code: every QR on a campaign shares the publisher.
    const slug = await this.repo.publisherSlug(id);
    return rows.map((q) => ({ ...q, scan_url: scanUrl(BASE_URL, q.code, slug) }));
  }

  // -------------------------------------------------------------------------------------- orgs

  /**
   * One credential for both machine callers — publisher keys earn fees on `/v1/attribution/*`,
   * promoter keys mint codes on `/v1/issue` — so one call revokes either.
   */
  async rotateKey(s: SessionClaims) {
    if (s.type === 'admin') throw new ForbiddenException('tenants only');
    const api_key = newApiKey();
    await this.repo.setApiKeyHash(s.org_id, sha256(api_key));
    // The old key dies the moment this lands, so sudden attribution 401s are usually this
    // event. Records that it happened, never the key.
    await this.repo.audit(s.org_id, 'org.rotate_key', `org:${s.org_id}`);
    return { api_key };
  }

  async me(s: SessionClaims) {
    const org = await this.repo.findOrg(s.org_id);
    // Fees accrue in `publisher:{org_id}`; `withdrawableNow` is the slice past the settlement
    // window and not already queued.
    return org.type === 'publisher'
      ? {
          ...org,
          earnings: await this.repo.balance(`publisher:${org.id}`),
          withdrawable: await this.repo.withdrawableNow(org.id),
        }
      : org;
  }

  // Publishers only: these are the fields the scan redirect reads off the publisher side.
  async patchOrg(s: SessionClaims, dto: PatchOrgDto) {
    if (s.type !== 'publisher') throw new ForbiddenException('publishers only');
    // Keyed on `undefined` vs `null`, not on truthiness: blanks normalise to null, so keying on
    // the value made clearing a field impossible — see PatchOrgDto in the admin module.
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

    // Judged on the post-patch org, not the body, so the pair can be set across two requests —
    // and clearing one alone is refused too.
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
    // `slug` is baked into printed QR codes — changing it orphans every code already out there.
    const updated = await this.repo.patchOrg(s.org_id, data);
    // After the write: auditing a rejected change is an inbox item about nothing.
    await this.repo.audit(s.org_id, 'org.patch', `org:${s.org_id}`, data);
    return updated;
  }

  // ------------------------------------------------------------------------------- withdrawals

  /**
   * A request, not a transfer: the ledger only moves when an admin pays it, capped at what has
   * cleared the clawback window.
   */
  async requestWithdrawal(s: SessionClaims, dto: RequestWithdrawalDto) {
    if (s.type !== 'publisher') throw new ForbiddenException('publishers only');
    const created = await this.repo.createWithdrawal(s.org_id, dto.coins);
    // Tenant actor, so it lands in the admin inbox before the request goes stale.
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
    // `coins` is gross, so publishers book revenue on `publisher_net` — recomputed through the
    // same `splitFee` the payout used so the two cannot drift.
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

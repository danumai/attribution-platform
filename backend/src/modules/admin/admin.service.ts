import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { scanUrl } from '../../common/attribution';
import { toBonuses } from '../../common/dto/bonus.dto';
import { validateRates } from '../../common/rates';
import { sha256 } from '../../common/security';
import { BASE_URL } from '../../config';
import { newApiKey } from '../auth/tokens';
import { AdminRepository, OrgPatch, QrCodePatch } from './admin.repository';
import {
  AckNotificationsDto,
  AdjustBudgetDto,
  PatchCampaignDto,
  PatchOrgDto,
  PatchPartnershipDto,
  PatchQrCodeDto,
  WithdrawalDecisionDto,
} from './dto/bodies.dto';
import {
  AnalyticsQuery,
  LedgerQuery,
  OrgsQuery,
  ScansQuery,
  WithdrawalsQuery,
} from './dto/queries.dto';
import { LimitQuery } from '../../common/dto/paging.dto';

/** How long an admin-issued password reset stays usable. Long enough to hand over, no longer. */
const RESET_TOKEN_TTL_MS = 3_600_000;

/**
 * Derived dashboard numbers, console response shapes, rate rules that need the stored row, and the
 * audit trail for every override. No org scoping: the controller's `AdminGuard` is the boundary.
 */
@Injectable()
export class AdminService {
  constructor(private readonly repo: AdminRepository) {}

  // ------------------------------------------------------------------------------------ orgs

  async overview() {
    const o = await this.repo.overview();
    return {
      ...o,
      // double-entry: every ref sums to zero, so the whole book must too
      ledger_balanced: o.ledger_sum === 0,
      /** false means a cached balance disagrees with its entries — stop spending, reconcile. */
      balances_reconciled: o.drifted_accounts === 0,
      conversion_rate: o.scans ? +(o.redemptions / o.scans).toFixed(3) : 0,
    };
  }

  async orgs(query: OrgsQuery) {
    const rows = await this.repo.listOrgs(query.q, query.limit);
    const [coins, counts] = await Promise.all([
      this.repo.balances(
        rows.filter((o) => o.type === 'publisher').map((o) => `publisher:${o.id}`),
      ),
      this.repo.orgCampaignCounts(),
    ]);
    const campaigns = new Map(counts.map((c) => [c.org_id, c.n]));
    const history = new Map(counts.map((c) => [c.org_id, c.has_history]));
    // The hash never crosses the boundary; whether one exists is all the console needs.
    return rows.map(({ api_key_hash, ...o }) => ({
      ...o,
      has_api_key: api_key_hash !== null,
      campaigns: campaigns.get(o.id) ?? 0,
      has_history: history.get(o.id) ?? false,
      coin_balance: o.type === 'publisher' ? (coins.get(`publisher:${o.id}`) ?? 0) : null,
    }));
  }

  async patchOrg(actorOrgId: string | null, id: string, dto: PatchOrgDto) {
    const data: OrgPatch = {
      ...(dto.suspended === undefined ? {} : { suspended: dto.suspended }),
      ...(dto.approved === undefined ? {} : { approved: dto.approved }),
      ...(dto.name === undefined ? {} : { name: dto.name }),
      // `undefined` vs `null`, not `in`: ES2022 class fields make every key exist on the instance,
      // so an unsent field stays `undefined` while a sent `""` is transformed to `null` and clears.
      ...(dto.landing_url === undefined ? {} : { landing_url: dto.landing_url }),
      ...(dto.deeplink_url === undefined ? {} : { deeplink_url: dto.deeplink_url }),
      ...(dto.android_package === undefined ? {} : { android_package: dto.android_package }),
      ...(dto.ios_app_id === undefined ? {} : { ios_app_id: dto.ios_app_id }),
      ...(dto.bonuses === undefined ? {} : { bonuses: toBonuses(dto.bonuses) }),
    };
    if (!(await this.repo.patchOrg(id, data))) throw new NotFoundException('org not found');
    await this.repo.audit(actorOrgId, 'org.patch', `org:${id}`, dto);
    return this.repo.findOrg(id);
  }

  /**
   * Both tenant types hold a key — publisher's for `/v1/attribution/*`, promoter's for `/v1/issue`
   * — so this must not be publisher-only or a promoter's leaked key is unrecoverable.
   */
  async rotateKey(actorOrgId: string | null, id: string) {
    const api_key = newApiKey();
    if (!(await this.repo.setApiKeyHash(id, sha256(api_key))))
      throw new NotFoundException('org not found');
    await this.repo.audit(actorOrgId, 'org.rotate_key', `org:${id}`);
    return { api_key }; // shown once
  }

  /**
   * Single-use reset token for a locked-out tenant: shown once, stored hashed. Audited because in
   * the wrong hands it is an account takeover, and "who issued it, for whom, when" is the defence.
   */
  async resetToken(actorOrgId: string | null, id: string) {
    const token = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    if (!(await this.repo.setResetToken(id, sha256(token), expires)))
      throw new NotFoundException('org not found');
    await this.repo.audit(actorOrgId, 'org.reset_token', `org:${id}`, {
      expires_at: expires.toISOString(),
    });
    return { reset_token: token, expires_at: expires.toISOString() }; // shown once
  }

  async offboard(actorOrgId: string | null, id: string, reason?: string) {
    const { org, campaigns_ended } = await this.repo.offboard(id);
    await this.repo.audit(actorOrgId, 'org.offboard', `org:${id}`, {
      reason: reason ?? null,
      campaigns_ended,
    });
    return { ...org, campaigns_ended, api_key_revoked: true };
  }

  async deleteOrg(actorOrgId: string | null, id: string) {
    const org = await this.repo.deleteOrg(id);
    // After the tx, like `offboard`: the audit row outlives the org since `org:{id}` is not an FK.
    await this.repo.audit(actorOrgId, 'org.delete', `org:${id}`, {
      name: org.name,
      type: org.type,
      email: org.email,
    });
    return { ...org, deleted: true };
  }

  // ---------------------------------------------------------------------------- partnerships

  async partnerships(query: LimitQuery) {
    const rows = await this.repo.listPartnerships(query.limit);
    return rows.map(({ promoter, publisher, ...p }) => ({
      ...p,
      promoter_name: promoter.name,
      publisher_name: publisher.name,
    }));
  }

  async patchPartnership(actorOrgId: string | null, id: string, dto: PatchPartnershipDto) {
    const current = await this.repo.findPartnership(id);
    if (!current) throw new NotFoundException('partnership not found');
    // Pair rule is checked on post-patch values against the stored row, which is why the four
    // rates carry no bounds in the DTO — the rule needs the row, so it cannot live in a pipe.
    const rates = validateRates(dto, current);

    // Any rate override must clear an open proposal: `decideRates` compare-and-sets on the
    // `proposed_*` columns alone, so a stale accept (proposed 80, overridden to 30) would win.
    const repriced =
      rates.coin_rate !== current.coin_rate ||
      rates.guest_rate !== current.guest_rate ||
      rates.engagement_rate !== current.engagement_rate;
    const proposal_cleared = repriced && current.proposed_coin_rate !== null;
    const updated = await this.repo.updatePartnership(id, {
      ...rates,
      platform_fee_bps: dto.platform_fee_bps ?? undefined,
      status: dto.status ?? undefined,
      ...(proposal_cleared
        ? { proposed_coin_rate: null, proposed_guest_rate: null, proposed_engagement_rate: null }
        : {}),
    });
    await this.repo.audit(actorOrgId, 'partnership.patch', `partnership:${id}`, {
      ...dto,
      // Recorded because the publisher will find an empty inbox where its pending price was.
      proposal_cleared,
    });
    return updated;
  }

  // ------------------------------------------------------------------------------- campaigns

  async campaigns(query: LimitQuery) {
    const rows = await this.repo.listCampaigns(query.limit);
    const budgets = await this.repo.balances(rows.map((c) => `campaign:${c.id}`));
    return rows.map(({ partnership, _count, ...c }) => ({
      ...c,
      coin_rate: partnership.coin_rate,
      engagement_rate: partnership.engagement_rate,
      promoter_name: partnership.promoter.name,
      publisher_name: partnership.publisher.name,
      scans: _count.scans,
      redemptions: _count.redemptions,
      budget: budgets.get(`campaign:${c.id}`) ?? 0,
    }));
  }

  async patchCampaign(actorOrgId: string | null, id: string, dto: PatchCampaignDto) {
    if (!(await this.repo.setCampaignStatus(id, dto.status)))
      throw new NotFoundException('campaign not found');
    await this.repo.audit(actorOrgId, 'campaign.patch', `campaign:${id}`, dto);
    return this.repo.findCampaign(id);
  }

  async kill(actorOrgId: string | null, id: string, reason?: string) {
    const { campaign, codes_voided } = await this.repo.killCampaign(id);
    await this.repo.audit(actorOrgId, 'campaign.kill', `campaign:${id}`, {
      reason: reason ?? null,
      codes_voided,
    });
    return { ...campaign, status: 'ended', codes_voided };
  }

  /**
   * Manual budget adjustment (goodwill credit or clawback). Existence is proved before the tx so a
   * typo'd id 404s instead of writing a ledger entry against an account nothing owns.
   */
  async adjust(actorOrgId: string | null, id: string, dto: AdjustBudgetDto) {
    if (!(await this.repo.campaignExists(id))) throw new NotFoundException('campaign not found');
    await this.repo.adjustBudget(id, dto.coins, dto.idempotency_key);
    await this.repo.audit(actorOrgId, 'campaign.adjust', `campaign:${id}`, dto);
    return { budget: await this.repo.balance(`campaign:${id}`), reason: dto.reason ?? null };
  }

  // -------------------------------------------------------------------------------- qr codes

  async qrCodes(query: LimitQuery) {
    const rows = await this.repo.listQrCodes(query.limit);
    return rows.map(({ campaign, _count, ...q }) => ({
      ...q,
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      scans: _count.scans,
      scan_url: scanUrl(BASE_URL, q.code, campaign.partnership.publisher.slug),
    }));
  }

  /** Audited because it loosens a money control. */
  async patchQr(actorOrgId: string | null, id: string, dto: PatchQrCodeDto) {
    // `null` clears the limit; an absent key leaves the field alone — see PatchQrCodeDto.
    const data: QrCodePatch = {
      ...(dto.expires_at === undefined
        ? {}
        : { expires_at: dto.expires_at === null ? null : new Date(dto.expires_at) }),
      ...(dto.max_uses === undefined ? {} : { max_uses: dto.max_uses }),
      ...(dto.voided === undefined ? {} : { voided: dto.voided }),
    };
    if (!(await this.repo.patchQrCode(id, data)))
      throw new NotFoundException('qr code not found');
    await this.repo.audit(actorOrgId, 'qr_code.override', `qr_code:${id}`, dto);
    return this.repo.findQrCode(id);
  }

  // ------------------------------------------------------------- notifications and audit log

  /** Admin inbox: unacknowledged tenant actions — the unread end of audit_log, not a new table. */
  async notifications(query: LimitQuery) {
    const rows = await this.repo.listNotifications(query.limit);
    return rows.map(({ actor, ...a }) => ({
      ...a,
      actor_name: actor?.name ?? null,
      actor_email: actor?.email ?? null,
      actor_type: actor?.type ?? null,
    }));
  }

  async ackNotifications(dto: AckNotificationsDto) {
    return { acknowledged: await this.repo.acknowledgeNotifications(dto.ids) };
  }

  async auditLog(query: LimitQuery) {
    const rows = await this.repo.listAuditLog(query.limit);
    return rows.map(({ actor, ...a }) => ({
      ...a,
      actor_name: actor?.name ?? null,
      actor_email: actor?.email ?? null,
    }));
  }

  // --------------------------------------------------------------------- scans / redemptions

  /** Same `scanAnalytics` the promoter's campaign page calls, so the two never disagree. */
  analytics(query: AnalyticsQuery) {
    return this.repo.scanAnalytics(query.campaign_id ?? null, query.days);
  }

  /** Scan-level data: who scanned what, when, on which device, and whether it converted. */
  async scans(query: ScansQuery) {
    const rows = await this.repo.listScans(query.campaign_id, query.limit);
    return rows.map((s) => ({
      id: s.id,
      scanned_at: s.scanned_at,
      user_agent: s.user_agent,
      platform: s.platform,
      country: s.country,
      city: s.city,
      language: s.language,
      referer_host: s.referer_host,
      os: s.os,
      browser: s.browser,
      device_type: s.device_type,
      client: s.client,
      consumed: s.consumed,
      qr_code: s.qr_code.code,
      campaign_id: s.campaign.id,
      campaign_name: s.campaign.name,
      promoter_name: s.campaign.partnership.promoter.name,
      publisher_name: s.campaign.partnership.publisher.name,
      redeemed: s.redemptions.length > 0,
      // Summed, not first: this is total budget cost, and one scan can be acquisition + purchase.
      coins: s.redemptions.length ? s.redemptions.reduce((n, r) => n + r.coins, 0) : null,
      // referrer | appclip | pasteboard | code — a misconfigured App Clip shows all `pasteboard`.
      match_method: s.redemptions.map((r) => r.match_method).join('+') || null,
      kind: s.redemptions.map((r) => r.kind).join('+') || null,
    }));
  }

  async redemptions(query: LimitQuery) {
    const rows = await this.repo.listRedemptions(query.limit);
    return rows.map(({ campaign, ...r }) => ({
      ...r,
      campaign_name: campaign.name,
      promoter_name: campaign.partnership.promoter.name,
      publisher_name: campaign.partnership.publisher.name,
    }));
  }

  // ----------------------------------------------------------------------------- withdrawals

  async withdrawals(query: WithdrawalsQuery) {
    const rows = await this.repo.listWithdrawals(query.status, query.limit);
    return rows.map(({ publisher, ...w }) => ({
      ...w,
      publisher_name: publisher.name,
      publisher_email: publisher.email,
    }));
  }

  /** Real money leaving; the balance floor keeps a publisher from being paid below zero. */
  async payWithdrawal(actorOrgId: string | null, id: string, dto: WithdrawalDecisionDto) {
    const note = dto.note ?? null;
    const paid = await this.repo.payWithdrawal(id, note);
    await this.repo.audit(actorOrgId, 'withdrawal.pay', `withdrawal:${id}`, {
      publisher_org_id: paid.publisher_org_id,
      coins: paid.coins,
      note,
    });
    return { ...paid, status: 'paid', note };
  }

  async rejectWithdrawal(actorOrgId: string | null, id: string, dto: WithdrawalDecisionDto) {
    const note = dto.note ?? null;
    if (!(await this.repo.rejectWithdrawal(id, note)))
      throw new NotFoundException('no requested withdrawal with that id');
    await this.repo.audit(actorOrgId, 'withdrawal.reject', `withdrawal:${id}`, { note });
    return this.repo.findWithdrawal(id);
  }

  // ---------------------------------------------------------------------------------- ledger

  async ledgerEntries(query: LedgerQuery) {
    const [entries, balances] = await this.repo.ledgerPage(query.account, query.limit);
    return { entries, balances };
  }
}

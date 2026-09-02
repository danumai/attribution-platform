import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BASE_URL } from '../../config';
import { scanUrl } from '../../common/attribution';
import {
  validateAndroidPackage,
  validateBonuses,
  validateIosAppId,
} from '../../common/attribution';
import { capped } from '../../common/paging';
import { validateRates } from '../../common/rates';
import { sha256, str, validateDeeplinkUrl, validateLandingUrl } from '../../common/security';
import { scanAnalytics } from '../../database/analytics';
import { audit, balance, balances, ledger, lockedBalance } from '../../database/ledger';
import { Tx, prisma } from '../../database/prisma';
import { AdminGuard, Session } from '../auth/auth.guard';
import { SessionClaims, newApiKey } from '../auth/tokens';
import { randomBytes } from 'node:crypto';

// Super admin: reads everything across all orgs, and can act on anything.
// No org scoping here — that is the whole point of the role.
@ApiTags('Admin')
@ApiBearerAuth('session')
@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  @Get('overview')
  async overview() {
    // One round trip for 27 aggregates. Twenty-seven Prisma `count`s would be twenty-seven queries.
    const [o] = await prisma.$queryRaw<Record<string, number>[]>`
      SELECT
        (SELECT count(*)::int FROM orgs WHERE type='promoter')            AS promoters,
        (SELECT count(*)::int FROM orgs WHERE type='publisher')           AS publishers,
        (SELECT count(*)::int FROM orgs WHERE suspended)                  AS suspended_orgs,
        (SELECT count(*)::int FROM partnerships)                          AS partnerships,
        (SELECT count(*)::int FROM partnerships WHERE status='pending')   AS pending_partnerships,
        (SELECT count(*)::int FROM campaigns)                             AS campaigns,
        (SELECT count(*)::int FROM campaigns WHERE status='active')       AS active_campaigns,
        (SELECT count(*)::int FROM campaigns WHERE mode='engagement')     AS engagement_campaigns,
        -- Split out because they are different products and their conversion rates are not
        -- comparable: an acquisition converts once per person ever, an engagement payout
        -- converts once per purchase, and averaging the two describes neither.
        (SELECT count(*)::int FROM redemptions WHERE kind='engagement')   AS engagement_redemptions,
        (SELECT coalesce(sum(coins),0)::int FROM redemptions WHERE kind='engagement') AS engagement_coins,
        (SELECT count(*)::int FROM qr_codes)                              AS qr_codes,
        (SELECT count(*)::int FROM scans)                                 AS scans,
        (SELECT count(*)::int FROM scans WHERE scanned_at > now() - interval '24 hours') AS scans_24h,
        (SELECT count(*)::int FROM redemptions)                           AS redemptions,
        (SELECT count(*)::int FROM redemptions WHERE identified)          AS identified_redemptions,
        (SELECT count(*)::int FROM redemptions WHERE NOT identified)      AS guest_redemptions,
        (SELECT count(*)::int FROM qr_codes WHERE voided)                 AS voided_codes,
        (SELECT coalesce(sum(coins),0)::int FROM redemptions)             AS coins_granted,
        (SELECT coalesce(-sum(amount),0)::int FROM ledger_entries WHERE account='external:funding') AS total_funded,
        -- The platform's own revenue: every payout's retained cut, accumulated. This is the
        -- number the business runs on.
        (SELECT coalesce(sum(amount),0)::int FROM ledger_entries WHERE account='platform:fees') AS platform_revenue,
        (SELECT coalesce(sum(amount),0)::int FROM ledger_entries WHERE account='external:payouts') AS total_paid_out,
        (SELECT count(*)::int FROM withdrawals WHERE status='requested')  AS open_withdrawals,
        (SELECT count(*)::int FROM orgs WHERE type='publisher' AND NOT approved AND NOT suspended) AS unapproved_publishers,
        (SELECT count(*)::int FROM payments WHERE status='pending')       AS pending_payments,
        (SELECT coalesce(sum(amount),0)::int FROM ledger_entries)         AS ledger_sum,
        -- The check ledger_sum cannot make. A global zero says the *book* is double-entry;
        -- it says nothing about whether the cached account_balances row every money path
        -- reads and locks still equals the entries behind it. Drift there spends real budget
        -- against a wrong number, and it stays invisible until someone reconciles by hand --
        -- which until now only the e2e script ever did.
        -- ponytail: aggregates the whole ledger. Fine at admin-dashboard frequency; when the
        -- book is big enough to feel it, move this to a scheduled reconciliation job that
        -- alerts, rather than a number rendered on page load.
        (SELECT count(*)::int FROM account_balances b
           LEFT JOIN (SELECT account, sum(amount)::int AS s FROM ledger_entries GROUP BY account) e
             ON e.account = b.account
          WHERE b.balance <> coalesce(e.s, 0))                            AS drifted_accounts,
        -- What tenants have done that nobody here has looked at yet — a funded budget, a
        -- repriced partnership. The same slice GET /notifications serves, counted for the badge.
        (SELECT count(*)::int FROM audit_log a
           JOIN orgs ao ON ao.id = a.actor_org_id
          WHERE a.acknowledged_at IS NULL AND ao.type <> 'admin')          AS open_notifications`;
    return {
      ...o,
      // ledger is double-entry: every ref sums to zero, so the whole book must too
      ledger_balanced: o.ledger_sum === 0,
      /** false means a cached balance disagrees with its entries — stop spending, reconcile. */
      balances_reconciled: o.drifted_accounts === 0,
      conversion_rate: o.scans ? +(o.redemptions / o.scans).toFixed(3) : 0,
    };
  }

  @Get('orgs')
  async orgs(@Query('q') q?: string, @Query('limit') limit?: string) {
    const rows = await prisma.org.findMany({
      take: capped(limit),
      where: {
        type: { not: 'admin' },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { email: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        type: true,
        email: true,
        landing_url: true,
        suspended: true,
        approved: true,
        created_at: true,
        api_key_hash: true,
      },
      orderBy: { created_at: 'desc' },
    });
    // Campaigns reachable from either side of a partnership — not a relation Prisma can
    // `_count`, since it spans two different foreign keys on the same table.
    const [coins, counts] = await Promise.all([
      balances(rows.filter((o) => o.type === 'publisher').map((o) => `publisher:${o.id}`)),
      prisma.$queryRaw<{ org_id: string; n: number; has_history: boolean }[]>`
        SELECT o.id AS org_id, count(c.id)::int AS n,
               -- Anything that makes the org undeletable, as one boolean. The ledger is checked
               -- by account string, not a join: entries carry publisher:{id} rather than a
               -- foreign key, which is exactly why they cannot be cleaned up after the fact.
               (EXISTS (SELECT 1 FROM partnerships p2
                         WHERE p2.promoter_org_id = o.id OR p2.publisher_org_id = o.id)
             OR EXISTS (SELECT 1 FROM payments pay WHERE pay.org_id = o.id)
             OR EXISTS (SELECT 1 FROM withdrawals w WHERE w.publisher_org_id = o.id)
             OR EXISTS (SELECT 1 FROM ledger_entries le
                         WHERE le.account = 'publisher:' || o.id)) AS has_history
        FROM orgs o
        LEFT JOIN partnerships p
          ON p.promoter_org_id = o.id OR p.publisher_org_id = o.id
        LEFT JOIN campaigns c ON c.partnership_id = p.id
        GROUP BY o.id`,
    ]);
    const campaigns = new Map(counts.map((c) => [c.org_id, c.n]));
    const history = new Map(counts.map((c) => [c.org_id, c.has_history]));
    return rows.map(({ api_key_hash, ...o }) => ({
      ...o,
      has_api_key: api_key_hash !== null,
      campaigns: campaigns.get(o.id) ?? 0,
      has_history: history.get(o.id) ?? false,
      coin_balance: o.type === 'publisher' ? (coins.get(`publisher:${o.id}`) ?? 0) : null,
    }));
  }

  @Patch('orgs/:id')
  async patchOrg(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body()
    b: {
      suspended?: boolean;
      /** the publisher-vetting gate: false hides the org from the directory and blocks new partnerships */
      approved?: boolean;
      name?: string;
      landing_url?: string;
      android_package?: string;
      ios_app_id?: string;
      deeplink_url?: string;
      bonuses?: unknown;
      reason?: string;
    },
  ) {
    const fields = {
      landing_url: validateLandingUrl(b.landing_url),
      android_package: validateAndroidPackage(b.android_package),
      ios_app_id: validateIosAppId(b.ios_app_id),
      deeplink_url: validateDeeplinkUrl(b.deeplink_url),
      bonuses: validateBonuses(b.bonuses),
    };
    if (b.suspended !== undefined && typeof b.suspended !== 'boolean')
      throw new BadRequestException('suspended must be a boolean');
    if (b.approved !== undefined && typeof b.approved !== 'boolean')
      throw new BadRequestException('approved must be a boolean');
    const updated = await prisma.org.updateMany({
      where: { id, type: { not: 'admin' } },
      data: {
        ...(b.suspended === undefined ? {} : { suspended: b.suspended }),
        ...(b.approved === undefined ? {} : { approved: b.approved }),
        // Bounded like every other free-text field crossing the boundary — unbounded, one
        // PATCH bloats the row and every listing that renders it.
        ...(b.name === undefined ? {} : { name: str(b.name, 'name', 120)! }),
        // Keyed on what was sent, so `""` clears a field instead of being ignored.
        ...Object.fromEntries(Object.entries(fields).filter(([k]) => k in b)),
      },
    });
    if (!updated.count) throw new NotFoundException('org not found');
    await audit(s.org_id, 'org.patch', `org:${id}`, b);
    return prisma.org.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        email: true,
        landing_url: true,
        android_package: true,
        ios_app_id: true,
        deeplink_url: true,
        bonuses: true,
        suspended: true,
        approved: true,
      },
    });
  }

  // Support path: tenant lost its key, or the key leaked. Both tenant types hold one now —
  // the publisher's earns fees on /v1/attribution/*, the promoter's mints codes on /v1/issue —
  // so restricting this to publishers left a promoter with a leaked key unrecoverable.
  @Post('orgs/:id/rotate-key')
  async rotateKey(@Session() s: SessionClaims, @Param('id') id: string) {
    const api_key = newApiKey();
    const updated = await prisma.org.updateMany({
      where: { id, type: { not: 'admin' } },
      data: { api_key_hash: sha256(api_key) },
    });
    if (!updated.count) throw new NotFoundException('org not found');
    await audit(s.org_id, 'org.rotate_key', `org:${id}`);
    return { api_key }; // shown once
  }

  /**
   * Issue a single-use password-reset token for a locked-out tenant. Shown once, expires in an
   * hour, stored hashed. The admin relays it over a channel they trust; when an email sender
   * exists it calls this and delivers the link itself. Audited — a reset token is an account
   * takeover in the wrong hands, and "who issued it, for whom, when" is the whole defence.
   */
  @Post('orgs/:id/reset-token')
  async resetToken(@Session() s: SessionClaims, @Param('id') id: string) {
    const token = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + 3_600_000);
    const updated = await prisma.org.updateMany({
      where: { id, type: { not: 'admin' } },
      data: { reset_token_hash: sha256(token), reset_token_expires: expires },
    });
    if (!updated.count) throw new NotFoundException('org not found');
    await audit(s.org_id, 'org.reset_token', `org:${id}`, { expires_at: expires.toISOString() });
    return { reset_token: token, expires_at: expires.toISOString() }; // shown once
  }

  // Offboarding: suspend, kill the API key, and stop every campaign in one action, so a
  // departed tenant retains neither access nor coin-grant capability.
  @Post('orgs/:id/offboard')
  async offboard(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { reason?: string },
  ) {
    const { org, campaigns_ended } = await prisma.$transaction(async (tx) => {
      const suspended = await tx.org.updateMany({
        where: { id, type: { not: 'admin' } },
        data: { suspended: true, api_key_hash: null },
      });
      if (!suspended.count) throw new NotFoundException('org not found');
      const stopped = await tx.campaign.updateMany({
        where: {
          status: { not: 'ended' },
          partnership: { OR: [{ promoter_org_id: id }, { publisher_org_id: id }] },
        },
        data: { status: 'ended' },
      });
      return {
        org: await tx.org.findUniqueOrThrow({
          where: { id },
          select: { id: true, name: true, type: true },
        }),
        campaigns_ended: stopped.count,
      };
    });
    await audit(s.org_id, 'org.offboard', `org:${id}`, {
      reason: b.reason ?? null,
      campaigns_ended,
    });
    return { ...org, campaigns_ended, api_key_revoked: true };
  }

  /**
   * The one deletion this system allows: an org that never traded.
   *
   * Everything else is `offboard`. The ledger is append-only by database trigger, and its rows
   * carry the org id inside an opaque `account` string rather than a foreign key — so removing
   * a tenant that ever earned or spent would leave balances pointing at nothing, with no way
   * to ever clean them up. A signup typo has none of that, and leaving it suspended forever is
   * just permanent clutter in a directory promoters have to read.
   */
  @Delete('orgs/:id')
  async deleteOrg(@Session() s: SessionClaims, @Param('id') id: string) {
    const org = await prisma.$transaction(async (tx) => {
      const o = await tx.org.findUnique({
        where: { id },
        select: { id: true, name: true, type: true, email: true },
      });
      // Admins are excluded the same way every other org route excludes them, and a missing
      // org is the same 404 — neither tells a caller which of the two it hit.
      if (!o || o.type === 'admin') throw new NotFoundException('org not found');

      // Counted inside the transaction: checking outside it would let a partnership created
      // mid-request survive the delete and orphan itself against a tenant that no longer
      // exists. The FKs are ON DELETE RESTRICT and would catch three of these four anyway —
      // `ledger_entries` is the one with no foreign key at all, so it needs the guard.
      const [partnerships, payments, withdrawals, ledger_entries] = await Promise.all([
        tx.partnership.count({ where: { OR: [{ promoter_org_id: id }, { publisher_org_id: id }] } }),
        tx.payment.count({ where: { org_id: id } }),
        tx.withdrawal.count({ where: { publisher_org_id: id } }),
        tx.ledgerEntry.count({ where: { account: `publisher:${id}` } }),
      ]);
      const held = Object.entries({ partnerships, payments, withdrawals, ledger_entries })
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`);
      if (held.length)
        throw new BadRequestException(
          `${o.name} has trading history (${held.join(', ')}) and cannot be deleted — offboard it instead`,
        );

      await tx.org.delete({ where: { id } });
      return o;
    });
    // After the transaction, like `offboard`: the audit row outlives the org it names, which
    // is the point — `org:{id}` is a string, not a foreign key.
    await audit(s.org_id, 'org.delete', `org:${id}`, {
      name: org.name,
      type: org.type,
      email: org.email,
    });
    return { ...org, deleted: true };
  }

  @Get('partnerships')
  async partnerships(@Query('limit') limit?: string) {
    const rows = await prisma.partnership.findMany({
      include: {
        promoter: { select: { name: true } },
        publisher: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' },
      take: capped(limit),
    });
    return rows.map(({ promoter, publisher, ...p }) => ({
      ...p,
      promoter_name: promoter.name,
      publisher_name: publisher.name,
    }));
  }

  @Patch('partnerships/:id')
  async patchPartnership(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body()
    b: {
      coin_rate?: number;
      guest_rate?: number;
      grace_days?: number;
      /** priced separately from the acquisition pair — see `validateRates` */
      engagement_rate?: number;
      platform_fee_bps?: number;
      status?: string;
    },
  ) {
    // `suspended` rather than `pending` is the pause lever: `pending` is the publisher's own
    // inbox state and the publisher can accept its way out of it, which is exactly what made
    // an admin suspension revertible by the org it was aimed at.
    if (b.status !== undefined && !['pending', 'active', 'suspended'].includes(b.status))
      throw new BadRequestException('status must be pending|active|suspended');
    // Admin-only, unlike the four negotiated rates: the take rate is the platform's own side
    // of the deal, and neither counterparty may set it.
    if (
      b.platform_fee_bps !== undefined &&
      (!Number.isInteger(b.platform_fee_bps) || b.platform_fee_bps < 0 || b.platform_fee_bps > 10_000)
    )
      throw new BadRequestException('platform_fee_bps must be an integer 0–10000');

    const current = await prisma.partnership.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('partnership not found');
    // Resolved against the existing row, so the pair rule is checked on the post-patch values
    // — raising only `guest_rate` has to be judged against the `coin_rate` already stored.
    const rates = validateRates(b, current);

    // An open proposal is cleared by any rate override, and that is the whole point: without
    // it an admin override is revertible by the party it was aimed at. Promoter proposes 80,
    // admin overrides to 30, publisher clicks accept on the proposal still sitting in its
    // inbox — `decideRates` compare-and-sets on the `proposed_*` columns alone, so it passes,
    // and 80 is back in force. Same shape as the `status: 'pending'` guard on `accept`: an
    // admin control must not be undoable by a tenant.
    const repriced =
      rates.coin_rate !== current.coin_rate ||
      rates.guest_rate !== current.guest_rate ||
      rates.engagement_rate !== current.engagement_rate;
    const updated = await prisma.partnership.update({
      where: { id },
      data: {
        ...rates,
        platform_fee_bps: b.platform_fee_bps ?? undefined,
        status: b.status ?? undefined,
        ...(repriced && current.proposed_coin_rate !== null
          ? {
              proposed_coin_rate: null,
              proposed_guest_rate: null,
              proposed_engagement_rate: null,
            }
          : {}),
      },
    });
    await audit(s.org_id, 'partnership.patch', `partnership:${id}`, {
      ...b,
      // The proposal did not merely go stale, it was discarded — and the publisher is about to
      // find an empty inbox where its pending price was.
      proposal_cleared: repriced && current.proposed_coin_rate !== null,
    });
    return updated;
  }

  @Get('campaigns')
  async campaigns(@Query('limit') limit?: string) {
    const rows = await prisma.campaign.findMany({
      take: capped(limit),
      include: {
        partnership: {
          select: {
            coin_rate: true,
            engagement_rate: true,
            promoter: { select: { name: true } },
            publisher: { select: { name: true } },
          },
        },
        _count: { select: { scans: true, redemptions: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    const budgets = await balances(rows.map((c) => `campaign:${c.id}`));
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

  @Patch('campaigns/:id')
  async patchCampaign(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { status: string; reason?: string },
  ) {
    if (!['active', 'paused', 'ended'].includes(b.status))
      throw new BadRequestException('status must be active|paused|ended');
    const updated = await prisma.campaign.updateMany({ where: { id }, data: { status: b.status } });
    if (!updated.count) throw new NotFoundException('campaign not found');
    await audit(s.org_id, 'campaign.patch', `campaign:${id}`, b);
    return prisma.campaign.findUnique({ where: { id } });
  }

  // Kill switch: stop a campaign and void every code it ever issued, in one call.
  @Post('campaigns/:id/kill')
  async kill(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { reason?: string },
  ) {
    const { campaign, codes_voided } = await prisma.$transaction(async (tx) => {
      const ended = await tx.campaign.updateMany({ where: { id }, data: { status: 'ended' } });
      if (!ended.count) throw new NotFoundException('campaign not found');
      const voided = await tx.qrCode.updateMany({
        where: { campaign_id: id, voided: false },
        data: { voided: true },
      });
      return {
        campaign: await tx.campaign.findUniqueOrThrow({
          where: { id },
          select: { id: true, name: true },
        }),
        codes_voided: voided.count,
      };
    });
    await audit(s.org_id, 'campaign.kill', `campaign:${id}`, {
      reason: b.reason ?? null,
      codes_voided,
    });
    return { ...campaign, status: 'ended', codes_voided };
  }

  // Per-code override of the default expiry/single-use rules — e.g. a permanent code on
  // store signage. Every change is audited because it loosens a money control.
  @Patch('qr-codes/:id')
  async patchQr(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body()
    b: { expires_at?: string | null; max_uses?: number | null; voided?: boolean; reason?: string },
  ) {
    if (b.expires_at !== undefined && b.expires_at !== null && isNaN(Date.parse(b.expires_at)))
      throw new BadRequestException('expires_at must be an ISO timestamp or null');
    if (
      b.max_uses !== undefined &&
      b.max_uses !== null &&
      (!Number.isInteger(b.max_uses) || b.max_uses < 1)
    )
      throw new BadRequestException('max_uses must be a positive integer or null');
    // `null` here means "clear the limit"; `undefined` (absent) is what leaves a field alone.
    const updated = await prisma.qrCode.updateMany({
      where: { id },
      data: {
        ...(b.expires_at === undefined
          ? {}
          : { expires_at: b.expires_at === null ? null : new Date(b.expires_at) }),
        ...(b.max_uses === undefined ? {} : { max_uses: b.max_uses }),
        ...(b.voided === undefined ? {} : { voided: b.voided }),
      },
    });
    if (!updated.count) throw new NotFoundException('qr code not found');
    await audit(s.org_id, 'qr_code.override', `qr_code:${id}`, b);
    return prisma.qrCode.findUnique({ where: { id } });
  }

  /**
   * The admin's inbox: everything a *tenant* did that nobody here has acknowledged yet.
   *
   * Not a second table — the actor is the whole rule: an audit entry with a tenant behind it is
   * something the platform did not do itself, so it stays here until acknowledged. Every tenant
   * action audited from now on arrives here for free.
   *
   * The audit log stays the record; this is only its unread end.
   */
  @Get('notifications')
  async notifications(@Query('limit') limit?: string) {
    const rows = await prisma.auditLog.findMany({
      where: { acknowledged_at: null, actor: { type: { not: 'admin' } } },
      include: { actor: { select: { name: true, email: true, type: true } } },
      orderBy: { created_at: 'desc' },
      take: capped(limit),
    });
    return rows.map(({ actor, ...a }) => ({
      ...a,
      actor_name: actor?.name ?? null,
      actor_email: actor?.email ?? null,
      actor_type: actor?.type ?? null,
    }));
  }

  /** Mark the named entries read, or the whole inbox when `ids` is omitted. */
  @Post('notifications/ack')
  async ackNotifications(@Body() b: { ids?: string[] }) {
    if (b.ids !== undefined && (!Array.isArray(b.ids) || b.ids.some((i) => typeof i !== 'string')))
      throw new BadRequestException('ids must be an array of strings');
    const { count } = await prisma.auditLog.updateMany({
      // Acknowledging is not a way to reach into admin's own entries or to re-date one already
      // handled: the same slice the inbox reads is the only slice this can touch.
      where: {
        acknowledged_at: null,
        actor: { type: { not: 'admin' } },
        ...(b.ids ? { id: { in: b.ids } } : {}),
      },
      data: { acknowledged_at: new Date() },
    });
    return { acknowledged: count };
  }

  @Get('audit-log')
  async auditLog(@Query('limit') limit?: string) {
    const rows = await prisma.auditLog.findMany({
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { created_at: 'desc' },
      take: capped(limit),
    });
    return rows.map(({ actor, ...a }) => ({
      ...a,
      actor_name: actor?.name ?? null,
      actor_email: actor?.email ?? null,
    }));
  }

  // Manual budget adjustment (goodwill credit, or clawing back a mis-funded campaign).
  // Negative amounts allowed, but never below zero — the ledger stays truthful either way.
  @Post('campaigns/:id/adjust')
  async adjust(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { coins: number; reason?: string; idempotency_key?: string },
  ) {
    if (!Number.isInteger(b.coins) || b.coins === 0 || Math.abs(b.coins) > 10_000_000)
      throw new BadRequestException('coins must be a non-zero integer within ±10000000');
    const campaign = await prisma.campaign.findUnique({ where: { id }, select: { id: true } });
    if (!campaign) throw new NotFoundException('campaign not found');
    // A goodwill credit is a hand-driven money-in path, which makes a double-submitted form the
    // likeliest way this endpoint ever pays twice. With a key the retry collides on
    // `UNIQUE (account, ref)` instead; see the note on the portal's `fund`.
    const key = str(b.idempotency_key, 'idempotency_key', 64, false);
    await prisma
      .$transaction(async (tx: Tx) => {
        if ((await lockedBalance(tx, `campaign:${id}`)) + b.coins < 0)
          throw new BadRequestException('adjustment would push budget below zero');
        const ref = `admin-adjust:${id}:${key ?? Date.now()}`;
        await ledger(tx, 'external:funding', -b.coins, ref);
        await ledger(tx, `campaign:${id}`, b.coins, ref);
      })
      .catch((e: any) => {
        if (e.code === 'P2002' && key) return; // already applied under this key
        throw e;
      });
    await audit(s.org_id, 'campaign.adjust', `campaign:${id}`, b);
    return { budget: await balance(`campaign:${id}`), reason: b.reason ?? null };
  }

  // Where scans come from, on what, when — platform-wide, or narrowed to one campaign.
  // Same function the promoter's own campaign page calls, so the two never disagree.
  @Get('analytics')
  async analytics(@Query('campaign_id') campaignId?: string, @Query('days') days?: string) {
    return scanAnalytics(campaignId || null, +(days ?? 30));
  }

  // scan-level data: who scanned what, when, on which device, and whether it converted
  @Get('scans')
  async scans(@Query('campaign_id') campaignId?: string, @Query('limit') limit?: string) {
    const rows = await prisma.scan.findMany({
      where: campaignId ? { campaign_id: campaignId } : {},
      select: {
        id: true,
        scanned_at: true,
        user_agent: true,
        platform: true,
        country: true,
        city: true,
        language: true,
        referer_host: true,
        os: true,
        browser: true,
        device_type: true,
        // How the hand-off screen behaved: how long it was held, and whether the scanner
        // tapped through or the bail-out fired. `exit: 'auto'` on an iOS scan is the shape of
        // an install that could never be attributed — nobody tapped, so nothing was carried.
        client: true,
        consumed: true,
        qr_code: { select: { code: true } },
        // Plural since a boarding-pass scan by somebody with no app yet pays twice — once as
        // an acquisition, once as the purchase it also was.
        redemptions: { select: { coins: true, match_method: true, kind: true } },
        campaign: {
          select: {
            id: true,
            name: true,
            partnership: {
              select: { promoter: { select: { name: true } }, publisher: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { scanned_at: 'desc' },
      take: capped(limit),
    });
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
      // Summed, not first: this column is "what this scan cost the campaign budget", and a
      // scan that was both an acquisition and a purchase cost it both.
      coins: s.redemptions.length
        ? s.redemptions.reduce((n, r) => n + r.coins, 0)
        : null,
      // which carrier brought the claim back: referrer | appclip | pasteboard | code. A
      // publisher whose App Clip is misconfigured shows up here as a column of `pasteboard`.
      match_method: s.redemptions.map((r) => r.match_method).join('+') || null,
      kind: s.redemptions.map((r) => r.kind).join('+') || null,
    }));
  }

  @Get('redemptions')
  async redemptions(@Query('limit') limit?: string) {
    const rows = await prisma.redemption.findMany({
      include: {
        campaign: {
          select: {
            name: true,
            partnership: {
              select: { promoter: { select: { name: true } }, publisher: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: capped(limit),
    });
    return rows.map(({ campaign, ...r }) => ({
      ...r,
      campaign_name: campaign.name,
      promoter_name: campaign.partnership.promoter.name,
      publisher_name: campaign.partnership.publisher.name,
    }));
  }

  @Get('qr-codes')
  async qrCodes(@Query('limit') limit?: string) {
    const rows = await prisma.qrCode.findMany({
      take: capped(limit),
      select: {
        id: true,
        code: true,
        created_at: true,
        expires_at: true,
        max_uses: true,
        uses: true,
        voided: true,
        campaign: {
          select: {
            id: true,
            name: true,
            partnership: { select: { publisher: { select: { slug: true } } } },
          },
        },
        _count: { select: { scans: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    return rows.map(({ campaign, _count, ...q }) => ({
      ...q,
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      scans: _count.scans,
      scan_url: scanUrl(BASE_URL, q.code, campaign.partnership.publisher.slug),
    }));
  }

  // ---------- withdrawals (publisher money-out, reviewed here) ----------

  @Get('withdrawals')
  async withdrawals(@Query('status') status?: string, @Query('limit') limit?: string) {
    const rows = await prisma.withdrawal.findMany({
      where: status ? { status } : {},
      include: { publisher: { select: { name: true, email: true } } },
      orderBy: { requested_at: 'desc' },
      take: capped(limit),
    });
    return rows.map(({ publisher, ...w }) => ({
      ...w,
      publisher_name: publisher.name,
      publisher_email: publisher.email,
    }));
  }

  /**
   * Pay a withdrawal: the review happened, real money is leaving. The ledger debits the
   * publisher and credits `external:payouts` under `withdrawal:{id}` — one ref, replay-safe,
   * and the account-balance floor guarantees a publisher can never be paid below zero even if
   * a clawback landed between request and approval.
   */
  @Post('withdrawals/:id/pay')
  async payWithdrawal(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { note?: string },
  ) {
    const note = str(b.note, 'note', 300, false);
    const paid = await prisma.$transaction(async (tx) => {
      // Status is flipped by the same UPDATE that tests it — two admins clicking pay at once
      // move the money once.
      const taken = await tx.withdrawal.updateMany({
        where: { id, status: 'requested' },
        data: { status: 'paid', note, decided_at: new Date() },
      });
      if (!taken.count) throw new NotFoundException('no requested withdrawal with that id');
      const w = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
      if ((await lockedBalance(tx, `publisher:${w.publisher_org_id}`)) < w.coins)
        throw new BadRequestException('publisher balance no longer covers this withdrawal');
      const ref = `withdrawal:${id}`;
      await ledger(tx, `publisher:${w.publisher_org_id}`, -w.coins, ref);
      await ledger(tx, 'external:payouts', w.coins, ref);
      return w;
    });
    await audit(s.org_id, 'withdrawal.pay', `withdrawal:${id}`, {
      publisher_org_id: paid.publisher_org_id,
      coins: paid.coins,
      note,
    });
    return { ...paid, status: 'paid', note };
  }

  @Post('withdrawals/:id/reject')
  async rejectWithdrawal(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { note?: string },
  ) {
    const note = str(b.note, 'note', 300, false);
    const updated = await prisma.withdrawal.updateMany({
      where: { id, status: 'requested' },
      data: { status: 'rejected', note, decided_at: new Date() },
    });
    if (!updated.count) throw new NotFoundException('no requested withdrawal with that id');
    await audit(s.org_id, 'withdrawal.reject', `withdrawal:${id}`, { note });
    return prisma.withdrawal.findUnique({ where: { id } });
  }

  @Get('ledger')
  async ledgerEntries(@Query('account') account?: string, @Query('limit') limit?: string) {
    const [entries, balances] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where: account ? { account } : {},
        orderBy: { created_at: 'desc' },
        take: capped(limit ?? '300'),
      }),
      prisma.accountBalance.findMany({ orderBy: { account: 'asc' } }),
    ]);
    return { entries, balances };
  }
}

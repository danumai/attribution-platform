import {
  BadRequestException,
  Body,
  Controller,
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
import { sha256, validateLandingUrl } from '../../common/security';
import { audit, balance, balances, ledger } from '../../database/ledger';
import { Tx, prisma } from '../../database/prisma';
import { AdminGuard, Session } from '../auth/auth.guard';
import { SessionClaims, newApiKey } from '../auth/tokens';

const capped = (limit?: string) => Math.min(+(limit ?? 200) || 200, 1000);

// Super admin: reads everything across all orgs, and can act on anything.
// No org scoping here — that is the whole point of the role.
@ApiTags('Admin')
@ApiBearerAuth('session')
@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  @Get('overview')
  async overview() {
    // One round trip for 17 aggregates. Seventeen Prisma `count`s would be seventeen queries.
    const [o] = await prisma.$queryRaw<Record<string, number>[]>`
      SELECT
        (SELECT count(*)::int FROM orgs WHERE type='promoter')            AS promoters,
        (SELECT count(*)::int FROM orgs WHERE type='publisher')           AS publishers,
        (SELECT count(*)::int FROM orgs WHERE suspended)                  AS suspended_orgs,
        (SELECT count(*)::int FROM partnerships)                          AS partnerships,
        (SELECT count(*)::int FROM partnerships WHERE status='pending')   AS pending_partnerships,
        (SELECT count(*)::int FROM campaigns)                             AS campaigns,
        (SELECT count(*)::int FROM campaigns WHERE status='active')       AS active_campaigns,
        (SELECT count(*)::int FROM qr_codes)                              AS qr_codes,
        (SELECT count(*)::int FROM scans)                                 AS scans,
        (SELECT count(*)::int FROM scans WHERE scanned_at > now() - interval '24 hours') AS scans_24h,
        (SELECT count(*)::int FROM redemptions)                           AS redemptions,
        (SELECT count(*)::int FROM redemptions WHERE identified)          AS identified_redemptions,
        (SELECT count(*)::int FROM redemptions WHERE NOT identified)      AS guest_redemptions,
        (SELECT count(*)::int FROM qr_codes WHERE voided)                 AS voided_codes,
        (SELECT coalesce(sum(coins),0)::int FROM redemptions)             AS coins_granted,
        (SELECT coalesce(-sum(amount),0)::int FROM ledger_entries WHERE account='external:funding') AS total_funded,
        (SELECT coalesce(sum(amount),0)::int FROM ledger_entries)         AS ledger_sum`;
    return {
      ...o,
      // ledger is double-entry: every ref sums to zero, so the whole book must too
      ledger_balanced: o.ledger_sum === 0,
      conversion_rate: o.scans ? +(o.redemptions / o.scans).toFixed(3) : 0,
    };
  }

  @Get('orgs')
  async orgs(@Query('q') q?: string) {
    const rows = await prisma.org.findMany({
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
        created_at: true,
        api_key_hash: true,
      },
      orderBy: { created_at: 'desc' },
    });
    // Campaigns reachable from either side of a partnership — not a relation Prisma can
    // `_count`, since it spans two different foreign keys on the same table.
    const [coins, counts] = await Promise.all([
      balances(rows.filter((o) => o.type === 'publisher').map((o) => `publisher:${o.id}`)),
      prisma.$queryRaw<{ org_id: string; n: number }[]>`
        SELECT o.id AS org_id, count(c.id)::int AS n
        FROM orgs o
        LEFT JOIN partnerships p
          ON p.promoter_org_id = o.id OR p.publisher_org_id = o.id
        LEFT JOIN campaigns c ON c.partnership_id = p.id
        GROUP BY o.id`,
    ]);
    const campaigns = new Map(counts.map((c) => [c.org_id, c.n]));
    return rows.map(({ api_key_hash, ...o }) => ({
      ...o,
      has_api_key: api_key_hash !== null,
      campaigns: campaigns.get(o.id) ?? 0,
      coin_balance: o.type === 'publisher' ? (coins.get(`publisher:${o.id}`) ?? 0) : null,
    }));
  }

  @Patch('orgs/:id')
  async patchOrg(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { suspended?: boolean; name?: string; landing_url?: string; reason?: string },
  ) {
    const landing_url = validateLandingUrl(b.landing_url);
    const updated = await prisma.org.updateMany({
      where: { id, type: { not: 'admin' } },
      data: {
        ...(b.suspended === undefined ? {} : { suspended: b.suspended }),
        ...(b.name === undefined ? {} : { name: b.name }),
        ...(landing_url === null ? {} : { landing_url }),
      },
    });
    if (!updated.count) throw new NotFoundException('org not found');
    await audit(s.org_id, 'org.patch', `org:${id}`, b);
    return prisma.org.findUnique({
      where: { id },
      select: { id: true, name: true, type: true, email: true, landing_url: true, suspended: true },
    });
  }

  // support path: publisher lost its key, or the key leaked
  @Post('orgs/:id/rotate-key')
  async rotateKey(@Session() s: SessionClaims, @Param('id') id: string) {
    const api_key = newApiKey();
    const updated = await prisma.org.updateMany({
      where: { id, type: 'publisher' },
      data: { api_key_hash: sha256(api_key) },
    });
    if (!updated.count) throw new NotFoundException('publisher not found');
    await audit(s.org_id, 'org.rotate_key', `org:${id}`);
    return { api_key }; // shown once
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

  @Get('partnerships')
  async partnerships() {
    const rows = await prisma.partnership.findMany({
      include: {
        promoter: { select: { name: true } },
        publisher: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' },
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
    b: { coin_rate?: number; guest_rate?: number; grace_days?: number; status?: string },
  ) {
    if (b.coin_rate !== undefined && (!Number.isInteger(b.coin_rate) || b.coin_rate < 1 || b.coin_rate > 100000))
      throw new BadRequestException('coin_rate must be 1–100000');
    if (b.guest_rate !== undefined && (!Number.isInteger(b.guest_rate) || b.guest_rate < 0))
      throw new BadRequestException('guest_rate must be a non-negative integer');
    if (b.grace_days !== undefined && (!Number.isInteger(b.grace_days) || b.grace_days < 0 || b.grace_days > 365))
      throw new BadRequestException('grace_days must be 0–365');
    if (b.status !== undefined && !['pending', 'active'].includes(b.status))
      throw new BadRequestException('status must be pending|active');

    const current = await prisma.partnership.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('partnership not found');
    // guest_rate <= coin_rate is a CHECK constraint the driver reports as an opaque error,
    // so compare the post-patch pair here to return something the caller can act on.
    if ((b.guest_rate ?? current.guest_rate) > (b.coin_rate ?? current.coin_rate))
      throw new BadRequestException('guest_rate cannot exceed coin_rate');

    const updated = await prisma.partnership.update({
      where: { id },
      data: {
        coin_rate: b.coin_rate ?? undefined,
        guest_rate: b.guest_rate ?? undefined,
        grace_days: b.grace_days ?? undefined,
        status: b.status ?? undefined,
      },
    });
    await audit(s.org_id, 'partnership.patch', `partnership:${id}`, b);
    return updated;
  }

  @Get('campaigns')
  async campaigns() {
    const rows = await prisma.campaign.findMany({
      include: {
        partnership: {
          select: {
            coin_rate: true,
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
    @Body() b: { coins: number; reason?: string },
  ) {
    if (!Number.isInteger(b.coins) || b.coins === 0 || Math.abs(b.coins) > 10_000_000)
      throw new BadRequestException('coins must be a non-zero integer within ±10000000');
    const campaign = await prisma.campaign.findUnique({ where: { id }, select: { id: true } });
    if (!campaign) throw new NotFoundException('campaign not found');
    await prisma.$transaction(async (tx: Tx) => {
      // lock the balance row so two concurrent debits can't both pass the >= 0 check
      const rows = await tx.$queryRaw<{ balance: number }[]>`
        SELECT balance FROM account_balances WHERE account = ${`campaign:${id}`} FOR UPDATE`;
      if ((rows[0]?.balance ?? 0) + b.coins < 0)
        throw new BadRequestException('adjustment would push budget below zero');
      const ref = `admin-adjust:${id}:${Date.now()}`;
      await ledger(tx, 'external:funding', -b.coins, ref);
      await ledger(tx, `campaign:${id}`, b.coins, ref);
    });
    await audit(s.org_id, 'campaign.adjust', `campaign:${id}`, b);
    return { budget: await balance(`campaign:${id}`), reason: b.reason ?? null };
  }

  // scan-level data: who scanned what, when, on which device, and whether it converted
  @Get('scans')
  async scans(@Query('campaign_id') campaignId?: string, @Query('limit') limit?: string) {
    const rows = await prisma.scan.findMany({
      where: campaignId ? { campaign_id: campaignId } : {},
      select: {
        id: true,
        scanned_at: true,
        ip: true,
        user_agent: true,
        consumed: true,
        qr_code: { select: { code: true } },
        redemption: { select: { coins: true } },
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
      ip_hash: s.ip,
      user_agent: s.user_agent,
      consumed: s.consumed,
      qr_code: s.qr_code.code,
      campaign_id: s.campaign.id,
      campaign_name: s.campaign.name,
      promoter_name: s.campaign.partnership.promoter.name,
      publisher_name: s.campaign.partnership.publisher.name,
      redeemed: s.redemption !== null,
      coins: s.redemption?.coins ?? null,
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
  async qrCodes() {
    const rows = await prisma.qrCode.findMany({
      select: {
        id: true,
        code: true,
        created_at: true,
        expires_at: true,
        max_uses: true,
        uses: true,
        voided: true,
        campaign: { select: { id: true, name: true } },
        _count: { select: { scans: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    return rows.map(({ campaign, _count, ...q }) => ({
      ...q,
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      scans: _count.scans,
      scan_url: `${BASE_URL}/r/${q.code}`,
    }));
  }

  @Get('ledger')
  async ledgerEntries(@Query('account') account?: string) {
    const [entries, balances] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where: account ? { account } : {},
        orderBy: { created_at: 'desc' },
        take: 300,
      }),
      prisma.accountBalance.findMany({ orderBy: { account: 'asc' } }),
    ]);
    return { entries, balances };
  }
}

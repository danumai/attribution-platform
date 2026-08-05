import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ALLOW_SELF_FUNDING, BASE_URL } from '../../config';
import {
  validateAndroidPackage,
  validateBonusLabel,
  validateIosAppId,
} from '../../common/attribution';
import { QrStyle, validateStyle } from '../../common/qr';
import { capped } from '../../common/paging';
import { validateRates } from '../../common/rates';
import { sha256, str, validateLandingUrl } from '../../common/security';
import { scanAnalytics } from '../../database/analytics';
import { audit, balance, balances, ledger } from '../../database/ledger';
import { prisma } from '../../database/prisma';
import { AuthGuard, Session } from '../auth/auth.guard';
import { SessionClaims, newApiKey, newShortCode } from '../auth/tokens';

@ApiTags('Portal')
@ApiBearerAuth('session')
@Controller('v1')
@UseGuards(AuthGuard)
export class PortalController {
  // ---------- directory & partnerships ----------

  // `ready` is what a promoter actually needs before committing a print run: a publisher with
  // no destination registered redirects nobody, so every scan of that campaign dies at
  // `no_destination`. Suspended publishers are hidden — partnering with one can never pay out.
  @Get('publishers')
  async publishers() {
    const rows = await prisma.org.findMany({
      where: { type: 'publisher', suspended: false },
      select: {
        id: true,
        name: true,
        bonus_label: true,
        landing_url: true,
        android_package: true,
        ios_app_id: true,
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(({ landing_url, android_package, ios_app_id, ...o }) => ({
      ...o,
      ready: Boolean(landing_url || android_package || ios_app_id),
    }));
  }

  @Post('partnerships')
  async requestPartnership(
    @Session() s: SessionClaims,
    @Body()
    b: {
      publisher_org_id: string;
      coin_rate?: number;
      guest_rate?: number;
      grace_days?: number;
    },
  ) {
    if (s.type !== 'promoter') throw new ForbiddenException('promoters only');
    // The foreign key only proves the id names *an org*. Without this, a promoter could open a
    // partnership against another promoter, an admin, or a publisher the directory deliberately
    // hides — none of which can ever pay out, so every campaign built on it dies at the
    // redirect with `no_destination` and the promoter has already printed the codes.
    const publisher = await prisma.org.findFirst({
      where: { id: b.publisher_org_id, type: 'publisher', suspended: false },
      select: { id: true },
    });
    if (!publisher) throw new BadRequestException('no such publisher');
    // No `current` row to resolve against — a new partnership takes the platform defaults for
    // anything the promoter left out. Same rules the admin patch runs, from one definition.
    const rates = validateRates(b);
    try {
      return await prisma.partnership.create({
        data: {
          promoter_org_id: s.org_id,
          publisher_org_id: b.publisher_org_id,
          ...rates,
        },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new BadRequestException('partnership already exists');
      if (e.code === 'P2003') throw new BadRequestException('publisher not found');
      throw e;
    }
  }

  @Get('partnerships')
  async listPartnerships(@Session() s: SessionClaims, @Query('limit') limit?: string) {
    const rows = await prisma.partnership.findMany({
      where: { OR: [{ promoter_org_id: s.org_id }, { publisher_org_id: s.org_id }] },
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

  @Post('partnerships/:id/accept')
  async accept(@Session() s: SessionClaims, @Param('id') id: string) {
    // updateMany so the publisher-ownership check is part of the WHERE, not a second query.
    //
    // `status: 'pending'` is part of that WHERE for the same reason: an admin suspending a
    // partnership is a control the publisher must not be able to undo, and with only two
    // states this endpoint *was* the undo — one call put a suspended relationship straight
    // back to `active`, and scans and payouts resumed against it.
    const updated = await prisma.partnership.updateMany({
      where: { id, publisher_org_id: s.org_id, status: 'pending' },
      data: { status: 'active' },
    });
    if (!updated.count) throw new NotFoundException();
    return prisma.partnership.findUnique({ where: { id } });
  }

  // ---------- campaigns ----------

  @Post('campaigns')
  async createCampaign(
    @Session() s: SessionClaims,
    @Body() b: { partnership_id: string; name: string },
  ) {
    const name = str(b.name, 'name', 120)!;
    const partnership = await prisma.partnership.findFirst({
      where: { id: b.partnership_id, promoter_org_id: s.org_id, status: 'active' },
      select: { id: true },
    });
    if (!partnership) throw new BadRequestException('no active partnership with that id');
    return prisma.campaign.create({ data: { partnership_id: b.partnership_id, name } });
  }

  @Get('campaigns')
  async listCampaigns(@Session() s: SessionClaims, @Query('limit') limit?: string) {
    const rows = await prisma.campaign.findMany({
      take: capped(limit),
      where: {
        partnership: {
          OR: [{ promoter_org_id: s.org_id }, { publisher_org_id: s.org_id }],
        },
      },
      include: {
        partnership: {
          select: {
            coin_rate: true,
            promoter: { select: { name: true } },
            publisher: { select: { name: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    const budgets = await balances(rows.map((c) => `campaign:${c.id}`));
    return rows.map(({ partnership, ...c }) => ({
      ...c,
      coin_rate: partnership.coin_rate,
      promoter_name: partnership.promoter.name,
      publisher_name: partnership.publisher.name,
      budget: budgets.get(`campaign:${c.id}`) ?? 0,
    }));
  }

  /** Either party may read a campaign; only the promoter may change it. */
  private async ownedCampaign(orgId: string, campaignId: string) {
    const c = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        partnership: { OR: [{ promoter_org_id: orgId }, { publisher_org_id: orgId }] },
      },
      include: {
        partnership: {
          select: { promoter_org_id: true, publisher_org_id: true, coin_rate: true },
        },
      },
    });
    if (!c) throw new NotFoundException('campaign not found');
    return c;
  }

  private async promoterCampaign(orgId: string, campaignId: string) {
    const c = await this.ownedCampaign(orgId, campaignId);
    if (c.partnership.promoter_org_id !== orgId) throw new ForbiddenException();
    return c;
  }

  // Demo funding: credits the campaign budget directly, with no payment behind it. Off in
  // production (see ALLOW_SELF_FUNDING) — left on, any promoter mints the budget that pays
  // publishers. Replace with a PSP checkout webhook that credits on `payment_intent.succeeded`.
  @Post('campaigns/:id/fund')
  async fund(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { coins: number },
  ) {
    if (!ALLOW_SELF_FUNDING)
      throw new ForbiddenException('direct funding is disabled — fund through checkout');
    await this.promoterCampaign(s.org_id, id);
    if (!Number.isInteger(b.coins) || b.coins < 1 || b.coins > 10_000_000)
      throw new BadRequestException('coins must be 1–10000000');
    await prisma.$transaction(async (tx) => {
      const ref = `fund:${id}:${Date.now()}`;
      await ledger(tx, 'external:funding', -b.coins, ref);
      await ledger(tx, `campaign:${id}`, b.coins, ref);
    });
    // Money entered the system without a payment record; the ledger alone does not say who
    // asked for it.
    await audit(s.org_id, 'campaign.fund', `campaign:${id}`, { coins: b.coins });
    return { budget: await balance(`campaign:${id}`) };
  }

  @Patch('campaigns/:id')
  async patchCampaign(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { status: string },
  ) {
    await this.promoterCampaign(s.org_id, id);
    if (!['active', 'paused', 'ended'].includes(b.status))
      throw new BadRequestException('status must be active|paused|ended');
    return prisma.campaign.update({ where: { id }, data: { status: b.status } });
  }

  @Get('campaigns/:id/stats')
  async stats(@Session() s: SessionClaims, @Param('id') id: string) {
    const c = await this.ownedCampaign(s.org_id, id);
    const [scans, reds, budget_remaining] = await Promise.all([
      prisma.scan.count({ where: { campaign_id: id } }),
      prisma.redemption.aggregate({
        where: { campaign_id: id },
        _count: true,
        _sum: { coins: true },
      }),
      balance(`campaign:${id}`),
    ]);
    return {
      name: c.name,
      status: c.status,
      scans,
      redemptions: reds._count,
      coins_granted: reds._sum.coins ?? 0,
      budget_remaining,
    };
  }

  /**
   * Where this campaign's scans came from — the reason a promoter funds a second print run.
   *
   * Read-only for both sides of the partnership, like `stats`: the publisher hosting the code
   * has as much reason to see which placement works as the promoter who printed it.
   * `ownedCampaign` is the whole authorisation story — it throws unless this session is one of
   * the two orgs on the partnership, so the id can never be used to read a stranger's traffic.
   */
  @Get('campaigns/:id/analytics')
  async analytics(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    await this.ownedCampaign(s.org_id, id);
    return scanAnalytics(id, +(days ?? 30));
  }

  // ---------- QR codes ----------

  @Post('campaigns/:id/qr-codes')
  async createQr(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { style?: QrStyle; expires_in_days?: number; max_uses?: number },
  ) {
    await this.promoterCampaign(s.org_id, id);
    const style = validateStyle(b.style ?? {});
    // time-bound by default; 0 days means "no expiry" and needs an admin override
    const days = b.expires_in_days ?? 30;
    if (!Number.isInteger(days) || days < 0 || days > 3650)
      throw new BadRequestException('expires_in_days must be an integer 0–3650');
    if (
      b.max_uses !== undefined &&
      b.max_uses !== null &&
      (!Number.isInteger(b.max_uses) || b.max_uses < 1)
    )
      throw new BadRequestException('max_uses must be a positive integer, or null for unlimited');
    const qr = await prisma.qrCode.create({
      data: {
        campaign_id: id,
        code: newShortCode(),
        style: style as object,
        expires_at: days === 0 ? null : new Date(Date.now() + days * 86_400_000),
        max_uses: b.max_uses ?? null,
      },
    });
    return { ...qr, scan_url: `${BASE_URL}/r/${qr.code}` };
  }

  // Promoters can kill their own code (lost/stolen print run) but cannot extend its life —
  // loosening a limit is an admin override so it lands in the audit log.
  @Post('qr-codes/:id/void')
  async voidQr(@Session() s: SessionClaims, @Param('id') id: string) {
    return this.updateOwnQr(s.org_id, id, { voided: true });
  }

  @Patch('qr-codes/:id')
  async restyleQr(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { style: QrStyle },
  ) {
    return this.updateOwnQr(s.org_id, id, { style: validateStyle(b.style ?? {}) as object });
  }

  private async updateOwnQr(orgId: string, id: string, data: { voided?: boolean; style?: object }) {
    const updated = await prisma.qrCode.updateMany({
      where: { id, campaign: { partnership: { promoter_org_id: orgId } } },
      data,
    });
    if (!updated.count) throw new NotFoundException();
    return prisma.qrCode.findUnique({ where: { id } });
  }

  @Get('campaigns/:id/qr-codes')
  async listQr(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    await this.ownedCampaign(s.org_id, id);
    const rows = await prisma.qrCode.findMany({
      where: { campaign_id: id },
      orderBy: { created_at: 'desc' },
      take: capped(limit),
    });
    return rows.map((q) => ({ ...q, scan_url: `${BASE_URL}/r/${q.code}` }));
  }

  // ---------- publisher settings ----------

  @Post('api-keys/rotate')
  async rotateKey(@Session() s: SessionClaims) {
    if (s.type !== 'publisher') throw new ForbiddenException('publishers only');
    const api_key = newApiKey();
    await prisma.org.update({
      where: { id: s.org_id },
      data: { api_key_hash: sha256(api_key) },
    });
    return { api_key };
  }

  @Get('orgs/me')
  async me(@Session() s: SessionClaims) {
    const org = await prisma.org.findUniqueOrThrow({
      where: { id: s.org_id },
      select: {
        id: true,
        name: true,
        type: true,
        email: true,
        landing_url: true,
        android_package: true,
        ios_app_id: true,
        bonus_label: true,
        suspended: true,
      },
    });
    // Every fee a publisher has earned lands in `publisher:{org_id}`; the admin portal could
    // read it and the publisher could not. Same number, own tenant.
    return org.type === 'publisher'
      ? { ...org, earnings: await balance(`publisher:${org.id}`) }
      : org;
  }

  /**
   * Where scans go, and what the publisher says it gives new users. Absent = leave unchanged;
   * an explicit `""` or `null` clears the field.
   *
   * Publishers only: these are the four fields the scan redirect reads off the *publisher*
   * side of a partnership. A promoter setting them wrote columns that nothing ever reads.
   */
  @Patch('orgs/me')
  async patchOrg(
    @Session() s: SessionClaims,
    @Body()
    b: {
      landing_url?: string;
      android_package?: string;
      ios_app_id?: string;
      bonus_label?: string;
    },
  ) {
    if (s.type !== 'publisher') throw new ForbiddenException('publishers only');
    const fields = {
      landing_url: validateLandingUrl(b.landing_url),
      android_package: validateAndroidPackage(b.android_package),
      ios_app_id: validateIosAppId(b.ios_app_id),
      bonus_label: validateBonusLabel(b.bonus_label),
    };
    // Filter on whether the key was *sent*, not on the validated value: every validator
    // returns null for a cleared field too, so filtering on the value made clearing impossible.
    return prisma.org.update({
      where: { id: s.org_id },
      data: Object.fromEntries(Object.entries(fields).filter(([k]) => k in b)),
      select: {
        id: true,
        name: true,
        type: true,
        landing_url: true,
        android_package: true,
        ios_app_id: true,
        bonus_label: true,
      },
    });
  }

  @Get('redemptions')
  async redemptions(@Session() s: SessionClaims, @Query('limit') limit?: string) {
    const rows = await prisma.redemption.findMany({
      where: {
        campaign: {
          partnership: {
            OR: [{ publisher_org_id: s.org_id }, { promoter_org_id: s.org_id }],
          },
        },
      },
      include: { campaign: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
      take: capped(limit ?? '100'),
    });
    return rows.map(({ campaign, ...r }) => ({ ...r, campaign_name: campaign.name }));
  }
}

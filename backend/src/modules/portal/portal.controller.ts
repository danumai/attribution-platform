import {
  BadRequestException,
  Body,
  ConflictException,
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
import { ALLOW_SELF_FUNDING, BASE_URL, PLATFORM_FEE_BPS } from '../../config';
import {
  allBonuses,
  campaignBonuses,
  scanUrl,
  validateAndroidPackage,
  validateAppClipId,
  validateBonuses,
  validateBonusTypes,
  validateIosAppId,
  validateProviderToken,
  validateSlug,
} from '../../common/attribution';
import { QrStyle, validateStyle } from '../../common/qr';
import { capped } from '../../common/paging';
import { splitFee, validateRates } from '../../common/rates';
import { sha256, str, validateDeeplinkUrl, validateLandingUrl } from '../../common/security';
import { scanAnalytics } from '../../database/analytics';
import { audit, balance, balances, ledger, withdrawable } from '../../database/ledger';
import { prisma } from '../../database/prisma';
import { AuthGuard, Session } from '../auth/auth.guard';
import { SessionClaims, newApiKey, newShortCode } from '../auth/tokens';

@ApiTags('Portal')
@ApiBearerAuth('session')
@Controller('v1')
@UseGuards(AuthGuard)
export class PortalController {

  // `ready` is what a promoter needs before committing a print run. Suspended and unapproved
  // publishers are hidden: neither can ever pay out.
  @Get('publishers')
  async publishers() {
    const rows = await prisma.org.findMany({
      where: { type: 'publisher', suspended: false, approved: true },
      select: {
        id: true,
        name: true,
        bonuses: true,
        landing_url: true,
        android_package: true,
        ios_app_id: true,
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(({ landing_url, android_package, ios_app_id, bonuses, ...o }) => ({
      ...o,
      bonuses: allBonuses(bonuses),
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
      engagement_rate?: number;
    },
  ) {
    if (s.type !== 'promoter') throw new ForbiddenException('promoters only');
    // The foreign key only proves the id names *an org*. Without this a promoter could partner
    // with one that can never pay out, and every campaign on it dies at the redirect.
    const publisher = await prisma.org.findFirst({
      where: { id: b.publisher_org_id, type: 'publisher', suspended: false, approved: true },
      select: { id: true },
    });
    if (!publisher) throw new BadRequestException('no such publisher');
    // No `current` row to resolve against: a new partnership takes the platform defaults for
    // anything left out, by the same rules the admin patch runs.
    const rates = validateRates(b);
    try {
      const created = await prisma.partnership.create({
        data: {
          promoter_org_id: s.org_id,
          publisher_org_id: b.publisher_org_id,
          ...rates,
          // Snapshotted, not read live at payout: changing the platform default must never
          // silently reprice a deal both parties already agreed to.
          platform_fee_bps: PLATFORM_FEE_BPS,
        },
      });
      await audit(s.org_id, 'partnership.create', `partnership:${created.id}`, {
        publisher_org_id: b.publisher_org_id,
        ...rates,
      });
      return created;
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
        publisher: { select: { name: true, bonuses: true } },
      },
      orderBy: { created_at: 'desc' },
      take: capped(limit),
    });
    return rows.map(({ promoter, publisher, ...p }) => ({
      ...p,
      promoter_name: promoter.name,
      publisher_name: publisher.name,
      // Read live off the publisher rather than snapshotted at agreement — the offer is the
      // publisher's own to change, and the promoter needs to see what a scanner gets today.
      publisher_bonuses: allBonuses(publisher.bonuses),
    }));
  }

  @Post('partnerships/:id/accept')
  async accept(@Session() s: SessionClaims, @Param('id') id: string) {
    // updateMany so the ownership check is in the WHERE, and `status: 'pending'` with it: with
    // only two states this endpoint *was* the undo for an admin suspension.
    const updated = await prisma.partnership.updateMany({
      where: { id, publisher_org_id: s.org_id, status: 'pending' },
      data: { status: 'active' },
    });
    if (!updated.count) throw new NotFoundException();
    await audit(s.org_id, 'partnership.accept', `partnership:${id}`);
    return prisma.partnership.findUnique({ where: { id } });
  }

  /**
   * Ask to reprice a live partnership. A request, not a change: the coin rate is what the
   * *publisher* is paid, and the money must not stop while the two sides talk, so the proposal
   * lands in its own columns. `active` only — a suspended partnership is an admin hold.
   */
  @Patch('partnerships/:id/rates')
  async proposeRates(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { coin_rate?: number; guest_rate?: number; engagement_rate?: number },
  ) {
    const current = await prisma.partnership.findFirst({
      where: { id, promoter_org_id: s.org_id, status: 'active' },
    });
    if (!current) throw new NotFoundException('no active partnership with that id');
    // Resolved against the row, so the pair rule is judged on the post-accept numbers: moving
    // only the coin rate still has to clear the guest rate already in force.
    const { coin_rate, guest_rate, engagement_rate } = validateRates(b, current);
    if (
      coin_rate === current.coin_rate &&
      guest_rate === current.guest_rate &&
      engagement_rate === current.engagement_rate
    )
      throw new BadRequestException('those are the rates already in force');
    // Written as a set even when only one moved: the proposal columns are all-or-nothing, and a
    // publisher accepting must see every number it is agreeing to, not a delta.
    const updated = await prisma.partnership.update({
      where: { id },
      data: {
        proposed_coin_rate: coin_rate,
        proposed_guest_rate: guest_rate,
        proposed_engagement_rate: engagement_rate,
      },
    });
    await audit(s.org_id, 'partnership.rates.propose', `partnership:${id}`, {
      from: {
        coin_rate: current.coin_rate,
        guest_rate: current.guest_rate,
        engagement_rate: current.engagement_rate,
      },
      to: { coin_rate, guest_rate, engagement_rate },
    });
    return updated;
  }

  @Post('partnerships/:id/rates/accept')
  async acceptRates(@Session() s: SessionClaims, @Param('id') id: string) {
    return this.decideRates(s, id, true);
  }

  /** Declining clears the proposal and leaves the agreed rates alone — the promoter can ask again. */
  @Post('partnerships/:id/rates/decline')
  async declineRates(@Session() s: SessionClaims, @Param('id') id: string) {
    return this.decideRates(s, id, false);
  }

  private async decideRates(s: SessionClaims, id: string, accept: boolean) {
    const p = await prisma.partnership.findFirst({
      where: { id, publisher_org_id: s.org_id, proposed_coin_rate: { not: null } },
    });
    if (!p) throw new NotFoundException('no open rate proposal');
    const cleared = {
      proposed_coin_rate: null,
      proposed_guest_rate: null,
      proposed_engagement_rate: null,
    };
    // Compare-and-set on the proposal itself: a revision between this publisher's read and its
    // click would otherwise apply a price nobody is looking at.
    const updated = await prisma.partnership.updateMany({
      where: {
        id,
        proposed_coin_rate: p.proposed_coin_rate,
        proposed_guest_rate: p.proposed_guest_rate,
        proposed_engagement_rate: p.proposed_engagement_rate,
      },
      data: accept
        ? {
            coin_rate: p.proposed_coin_rate!,
            guest_rate: p.proposed_guest_rate!,
            engagement_rate: p.proposed_engagement_rate!,
            ...cleared,
          }
        : cleared,
    });
    if (!updated.count) throw new BadRequestException('the proposal changed — reload and look again');
    await audit(s.org_id, `partnership.rates.${accept ? 'accept' : 'decline'}`, `partnership:${id}`, {
      coin_rate: p.proposed_coin_rate,
      guest_rate: p.proposed_guest_rate,
      engagement_rate: p.proposed_engagement_rate,
    });
    return prisma.partnership.findUnique({ where: { id } });
  }


  /**
   * `mode` is fixed at creation: it selects which payout guarantee the redemptions live under, and
   * those are partial unique indexes over rows that already exist. Two campaigns is the honest way
   * to run both, and they can share a partnership.
   */
  @Post('campaigns')
  async createCampaign(
    @Session() s: SessionClaims,
    @Body() b: { partnership_id: string; name: string; mode?: string; bonus_types?: unknown },
  ) {
    const name = str(b.name, 'name', 120)!;
    const mode = b.mode ?? 'acquisition';
    if (!['acquisition', 'engagement'].includes(mode))
      throw new BadRequestException('mode must be acquisition|engagement');
    const partnership = await prisma.partnership.findFirst({
      where: { id: b.partnership_id, promoter_org_id: s.org_id, status: 'active' },
      select: { id: true, publisher: { select: { bonuses: true } } },
    });
    if (!partnership) throw new BadRequestException('no active partnership with that id');
    // Which of the publisher's own offers this campaign advertises, checked against what that
    // publisher grants for this mode — the artwork is printed off this.
    const bonus_types = validateBonusTypes(
      b.bonus_types,
      campaignBonuses(partnership.publisher.bonuses, mode),
    );
    const created = await prisma.campaign.create({
      data: { partnership_id: b.partnership_id, name, mode, bonus_types },
    });
    await audit(s.org_id, 'campaign.create', `campaign:${created.id}`, {
      name,
      mode,
      bonus_types,
      partnership_id: b.partnership_id,
    });
    return created;
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
            engagement_rate: true,
            promoter: { select: { name: true } },
            publisher: { select: { name: true, bonuses: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    const budgets = await balances(rows.map((c) => `campaign:${c.id}`));
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
    const c = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        partnership: { OR: [{ promoter_org_id: orgId }, { publisher_org_id: orgId }] },
      },
      include: {
        partnership: {
          select: {
            promoter_org_id: true,
            publisher_org_id: true,
            coin_rate: true,
            publisher: { select: { bonuses: true } },
          },
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

    // Demo funding: credits the budget with no payment behind it, so it is off in production —
    // left on, any promoter mints the budget that pays publishers.
  @Post('campaigns/:id/fund')
  async fund(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { coins: number; idempotency_key?: string },
  ) {
    if (!ALLOW_SELF_FUNDING)
      throw new ForbiddenException('direct funding is disabled — fund through checkout');
    await this.promoterCampaign(s.org_id, id);
    if (!Number.isInteger(b.coins) || b.coins < 1 || b.coins > 10_000_000)
      throw new BadRequestException('coins must be 1–10000000');
    // Keyed on the caller's own key when it sends one, so a retry collides on `UNIQUE (account,
    // ref)`. The PSP checkout that replaces this keys on the payment intent, the same shape.
    const key = str(b.idempotency_key, 'idempotency_key', 64, false);
    await prisma
      .$transaction(async (tx) => {
        const ref = `fund:${id}:${key ?? Date.now()}`;
        await ledger(tx, 'external:funding', -b.coins, ref);
        await ledger(tx, `campaign:${id}`, b.coins, ref);
      })
      .catch((e: any) => {
        // Same key, same campaign: the first call already landed, and the current budget is
        // the honest reply.
        if (e.code === 'P2002' && key) return;
        throw e;
      });
    // Money entered without a payment record, so the ledger alone does not say who asked for it.
    // Also the admin's notification, which is why it carries the resulting budget.
    const budget = await balance(`campaign:${id}`);
    await audit(s.org_id, 'campaign.fund', `campaign:${id}`, { coins: b.coins, budget });
    return { budget };
  }

  @Patch('campaigns/:id')
  async patchCampaign(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { name?: string; status?: string; bonus_types?: unknown },
  ) {
    const c = await this.promoterCampaign(s.org_id, id);
    // Absent = leave unchanged, as in `PATCH orgs/me`, so a rename need not restate the status
    // and quietly reactivate an ended campaign.
    const data: { name?: string; status?: string; bonus_types?: string[] } = {};
    if ('name' in b) data.name = str(b.name, 'name', 120)!;
    // The reward is repickable, unlike `mode`: nothing was paid at these slugs. What cannot be
    // redone is the poster, so this is deliberate rather than something that drifts.
    if ('bonus_types' in b)
      data.bonus_types = validateBonusTypes(
        b.bonus_types,
        campaignBonuses(c.partnership.publisher.bonuses, c.mode),
      );
    if ('status' in b) {
      if (!['active', 'paused', 'ended'].includes(b.status!))
        throw new BadRequestException('status must be active|paused|ended');
      data.status = b.status;
    }
    if (!Object.keys(data).length) throw new BadRequestException('nothing to update');
    const updated = await prisma.campaign.update({ where: { id }, data });
    // Audited because it is a tenant changing something the platform is answerable for, and the
    // admin's inbox is built out of exactly those entries.
    await audit(s.org_id, 'campaign.patch', `campaign:${id}`, data);
    return updated;
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
      // A poster on an engagement campaign cannot promise the signup offer, and one selling
      // coins does not also promise the free month.
      publisher_bonuses: campaignBonuses(c.partnership.publisher.bonuses, c.mode, c.bonus_types),
    };
  }

  /** Where this campaign's scans came from. Read-only for both sides; `ownedCampaign` throws
   *  unless the session is one of the two orgs on the partnership. */
  @Get('campaigns/:id/analytics')
  async analytics(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    await this.ownedCampaign(s.org_id, id);
    return scanAnalytics(id, +(days ?? 30));
  }


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
    return { ...qr, scan_url: scanUrl(BASE_URL, qr.code, await this.publisherSlug(id)) };
  }

  // Promoters can kill their own code (lost or stolen print run) but cannot extend its life —
  // loosening a limit is an admin override so it lands in the audit log.
  @Post('qr-codes/:id/void')
  async voidQr(@Session() s: SessionClaims, @Param('id') id: string) {
    const qr = await this.updateOwnQr(s.org_id, id, { voided: true });
    // Killing a code is the one QR action worth an admin's attention: a print run just stopped
    // working, and the support call arrives before anyone checks a log.
    await audit(s.org_id, 'qr_code.void', `qr_code:${id}`, { code: qr?.code });
    return qr;
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
    // One lookup for the page rather than one per code: every QR on a campaign points at the
    // same publisher.
    const slug = await this.publisherSlug(id);
    return rows.map((q) => ({ ...q, scan_url: scanUrl(BASE_URL, q.code, slug) }));
  }

  /** The publisher's App Clip slug for a campaign, or NULL. Its own query because the join is
   *  campaign → partnership → publisher, three tables from the thing being listed. */
  private async publisherSlug(campaignId: string): Promise<string | null> {
    const c = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { partnership: { select: { publisher: { select: { slug: true } } } } },
    });
    return c?.partnership.publisher.slug ?? null;
  }


  /** Both machine callers rotate their key here: a publisher's earns fees on `/v1/attribution/*`,
   *  a promoter's mints codes on `/v1/issue`. Same credential, same one-call revocation. */
  @Post('api-keys/rotate')
  async rotateKey(@Session() s: SessionClaims) {
    if (s.type === 'admin') throw new ForbiddenException('tenants only');
    const api_key = newApiKey();
    await prisma.org.update({
      where: { id: s.org_id },
      data: { api_key_hash: sha256(api_key) },
    });
    // The old key stops earning fees the moment this lands, so a publisher whose attribution
    // calls start 401ing is usually this event. Never the key itself, only that it happened.
    await audit(s.org_id, 'org.rotate_key', `org:${s.org_id}`);
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
        ios_appclip_id: true,
        ios_provider_token: true,
        slug: true,
        deeplink_url: true,
        bonuses: true,
        suspended: true,
        approved: true,
      },
    });
    // Every fee a publisher has earned lands in `publisher:{org_id}`. `withdrawable` is the
    // slice of it that has cleared the settlement window and is not already queued.
    return org.type === 'publisher'
      ? {
          ...org,
          earnings: await balance(`publisher:${org.id}`),
          // Read without the lock and without a transaction: this is a figure on a page, and
          // the request that spends against it takes the lock itself.
          withdrawable: await withdrawable(prisma, org.id, false),
        }
      : org;
  }

  /**
   * Where scans go, and what the publisher says it gives new users. Absent = leave unchanged; an
   * explicit `""`, `null` or `[]` clears the field. Publishers only — these are the fields the
   * scan redirect reads off the *publisher* side of a partnership.
   *
   * `slug` and `ios_appclip_id` are checked as a pair: one without the other registers a prefix
   * nothing answers to, and the symptom at scan time is zero attribution with no error anywhere.
   */
  @Patch('orgs/me')
  async patchOrg(
    @Session() s: SessionClaims,
    @Body()
    b: {
      landing_url?: string;
      android_package?: string;
      ios_app_id?: string;
      /** `TEAMID.bundle.id.Clip` — set it and this publisher's QR codes become App Clip URLs */
      ios_appclip_id?: string;
      /** the path segment of that App Clip URL, and the prefix registered in App Store Connect */
      slug?: string;
      /** App Store Connect provider token, for the aggregate campaign-link cross-check */
      ios_provider_token?: string;
      /** an https origin claimed as an Android App Link / iOS Universal Link */
      deeplink_url?: string;
      /** the publisher's own offers, replaced wholesale — see `validateBonuses` */
      bonuses?: unknown;
    },
  ) {
    if (s.type !== 'publisher') throw new ForbiddenException('publishers only');
    const fields = {
      landing_url: validateLandingUrl(b.landing_url),
      android_package: validateAndroidPackage(b.android_package),
      ios_app_id: validateIosAppId(b.ios_app_id),
      ios_appclip_id: validateAppClipId(b.ios_appclip_id),
      slug: validateSlug(b.slug),
      ios_provider_token: validateProviderToken(b.ios_provider_token),
      deeplink_url: validateDeeplinkUrl(b.deeplink_url),
      bonuses: validateBonuses(b.bonuses),
    };

    // Checked against what the org will hold *after* this patch, not the body alone, so setting
    // one field today and the other tomorrow works — and clearing one alone is refused too.
    const current = await prisma.org.findUniqueOrThrow({
      where: { id: s.org_id },
      select: { slug: true, ios_appclip_id: true },
    });
    const after = {
      slug: 'slug' in b ? fields.slug : current.slug,
      ios_appclip_id: 'ios_appclip_id' in b ? fields.ios_appclip_id : current.ios_appclip_id,
    };
    if (Boolean(after.slug) !== Boolean(after.ios_appclip_id))
      throw new BadRequestException(
        'slug and ios_appclip_id must be set together — one without the other registers an App Clip URL that nothing answers to',
      );
    // Filter on whether the key was *sent*, not on the validated value: every validator returns
    // null for a cleared field too, so filtering on the value made clearing impossible.
    const data = Object.fromEntries(Object.entries(fields).filter(([k]) => k in b));
    // A promoter's whole print run follows these fields, and `slug` is baked into printed QR
    // codes — changing it orphans every code already in the world.
    const updated = await prisma.org
      .update({
        where: { id: s.org_id },
        data,
        select: {
          id: true,
          name: true,
          type: true,
          landing_url: true,
          android_package: true,
          ios_app_id: true,
          ios_appclip_id: true,
          ios_provider_token: true,
          slug: true,
          deeplink_url: true,
          bonuses: true,
        },
      })
      .catch((e: { code?: string }) => {
        // UNIQUE on `slug`. A 409 rather than a 500: a name someone else took is the
        // publisher's to resolve by picking another.
        if (e.code === 'P2002') throw new ConflictException('that slug is already taken');
        throw e;
      });
    // After the write: an entry for a change that was rejected is an inbox item about something
    // that never happened.
    await audit(s.org_id, 'org.patch', `org:${s.org_id}`, data);
    return updated;
  }


  /** Ask for earned fees to be paid out. A request, not a transfer: the ledger only moves when an
   *  admin pays it, capped at what has cleared the clawback window. */
  @Post('withdrawals')
  async requestWithdrawal(@Session() s: SessionClaims, @Body() b: { coins: number }) {
    if (s.type !== 'publisher') throw new ForbiddenException('publishers only');
    if (!Number.isInteger(b.coins) || b.coins < 1 || b.coins > 10_000_000)
      throw new BadRequestException('coins must be 1–10000000');
    const created = await prisma.$transaction(async (tx) => {
      // `withdrawable` locks the balance row, so two concurrent requests serialise here and the
      // second is judged against a pool the first has already claimed from.
      const available = await withdrawable(tx, s.org_id);
      if (b.coins > available)
        throw new BadRequestException(
          `only ${available} coins are withdrawable — the rest is still inside the settlement window`,
        );
      return tx.withdrawal.create({ data: { publisher_org_id: s.org_id, coins: b.coins } });
    });
    // Tenant actor, so it lands in the admin inbox — a payout request must be seen before it
    // goes stale.
    await audit(s.org_id, 'withdrawal.request', `withdrawal:${created.id}`, { coins: b.coins });
    return created;
  }

  @Get('withdrawals')
  async listWithdrawals(@Session() s: SessionClaims, @Query('limit') limit?: string) {
    if (s.type !== 'publisher') throw new ForbiddenException('publishers only');
    return prisma.withdrawal.findMany({
      where: { publisher_org_id: s.org_id },
      orderBy: { requested_at: 'desc' },
      take: capped(limit),
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
      include: {
        campaign: {
          select: { name: true, partnership: { select: { platform_fee_bps: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
      take: capped(limit ?? '100'),
    });
    // The integration guide tells publishers to book revenue on `publisher_net`, and `coins` is the
    // gross, so a publisher summing it over-reports by the platform's cut on every row. Recomputed
    // through the same `splitFee` the payout used, so the two cannot drift.
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

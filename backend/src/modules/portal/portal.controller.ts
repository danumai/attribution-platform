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
import { ALLOW_SELF_FUNDING, BASE_URL, PLATFORM_FEE_BPS } from '../../config';
import {
  validateAndroidPackage,
  validateBonusLabel,
  validateIosAppId,
} from '../../common/attribution';
import { QrStyle, validateStyle } from '../../common/qr';
import { capped } from '../../common/paging';
import { validateRates } from '../../common/rates';
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
  // ---------- directory & partnerships ----------

  // `ready` is what a promoter actually needs before committing a print run: a publisher with
  // no destination registered redirects nobody, so every scan of that campaign dies at
  // `no_destination`. Suspended publishers are hidden — partnering with one can never pay out.
  // Unapproved ones too: an account nobody has vetted must not be one partnership away from
  // receiving money.
  @Get('publishers')
  async publishers() {
    const rows = await prisma.org.findMany({
      where: { type: 'publisher', suspended: false, approved: true },
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
      engagement_rate?: number;
    },
  ) {
    if (s.type !== 'promoter') throw new ForbiddenException('promoters only');
    // The foreign key only proves the id names *an org*. Without this, a promoter could open a
    // partnership against another promoter, an admin, or a publisher the directory deliberately
    // hides — none of which can ever pay out, so every campaign built on it dies at the
    // redirect with `no_destination` and the promoter has already printed the codes.
    const publisher = await prisma.org.findFirst({
      where: { id: b.publisher_org_id, type: 'publisher', suspended: false, approved: true },
      select: { id: true },
    });
    if (!publisher) throw new BadRequestException('no such publisher');
    // No `current` row to resolve against — a new partnership takes the platform defaults for
    // anything the promoter left out. Same rules the admin patch runs, from one definition.
    const rates = validateRates(b);
    try {
      const created = await prisma.partnership.create({
        data: {
          promoter_org_id: s.org_id,
          publisher_org_id: b.publisher_org_id,
          ...rates,
          // Snapshotted, not read live at payout time: changing the platform default must
          // never silently reprice a deal both parties already agreed to.
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
    await audit(s.org_id, 'partnership.accept', `partnership:${id}`);
    return prisma.partnership.findUnique({ where: { id } });
  }

  /**
   * Ask to reprice a live partnership. Promoter side, and a request rather than a change.
   *
   * The coin rate is what the *publisher* is paid, so the promoter cannot simply set it — and
   * the money must not stop while the two sides talk. The proposal lands in its own columns
   * while payouts keep reading the agreed rates; `rates/accept` is the only thing that promotes
   * it.
   *
   * `active` only: a pending partnership has no agreed price to renegotiate (the publisher has
   * not accepted the first one), and a suspended one is an admin hold that new terms must not
   * quietly work around.
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
    // only the coin rate has to clear the guest rate already in force.
    const { coin_rate, guest_rate, engagement_rate } = validateRates(b, current);
    if (
      coin_rate === current.coin_rate &&
      guest_rate === current.guest_rate &&
      engagement_rate === current.engagement_rate
    )
      throw new BadRequestException('those are the rates already in force');
    // Written as a set even when only one moved: the proposal columns are all-or-nothing in the
    // database, and a publisher accepting must see every number it is agreeing to, not a delta
    // it has to resolve against whatever the live rates happened to be when it clicked.
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
    // Compare-and-set on the proposal itself: if the promoter revised it between this
    // publisher's read and its click, the click applied a price nobody is looking at. All three
    // are in the WHERE for that reason — a revision that moved only the engagement rate is
    // still a different proposal from the one on screen.
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

  // ---------- campaigns ----------

  /**
   * `mode` is fixed at creation and there is no endpoint to change it, deliberately. It selects
   * which payout guarantee the campaign's redemptions live under, and those are partial unique
   * indexes over rows that already exist — flipping a campaign to `engagement` after it has
   * paid acquisitions would leave a run of rows sitting under a rule they were never checked
   * against. Two campaigns is the honest way to run both, and they can share a partnership.
   */
  @Post('campaigns')
  async createCampaign(
    @Session() s: SessionClaims,
    @Body() b: { partnership_id: string; name: string; mode?: string },
  ) {
    const name = str(b.name, 'name', 120)!;
    const mode = b.mode ?? 'acquisition';
    if (!['acquisition', 'engagement'].includes(mode))
      throw new BadRequestException('mode must be acquisition|engagement');
    const partnership = await prisma.partnership.findFirst({
      where: { id: b.partnership_id, promoter_org_id: s.org_id, status: 'active' },
      select: { id: true },
    });
    if (!partnership) throw new BadRequestException('no active partnership with that id');
    const created = await prisma.campaign.create({
      data: { partnership_id: b.partnership_id, name, mode },
    });
    await audit(s.org_id, 'campaign.create', `campaign:${created.id}`, {
      name,
      mode,
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
      engagement_rate: partnership.engagement_rate,
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
    @Body() b: { coins: number; idempotency_key?: string },
  ) {
    if (!ALLOW_SELF_FUNDING)
      throw new ForbiddenException('direct funding is disabled — fund through checkout');
    await this.promoterCampaign(s.org_id, id);
    if (!Number.isInteger(b.coins) || b.coins < 1 || b.coins > 10_000_000)
      throw new BadRequestException('coins must be 1–10000000');
    // Keyed on the caller's own key when it sends one, so a retried request — a double-clicked
    // button, a proxy retry, an at-least-once job — collides on `UNIQUE (account, ref)` and
    // credits nothing twice. Without a key the ref is still per-request, which is the old
    // behaviour: a retry funds again. The PSP checkout that replaces this endpoint keys on the
    // payment intent id, which is exactly the same shape.
    const key = str(b.idempotency_key, 'idempotency_key', 64, false);
    await prisma
      .$transaction(async (tx) => {
        const ref = `fund:${id}:${key ?? Date.now()}`;
        await ledger(tx, 'external:funding', -b.coins, ref);
        await ledger(tx, `campaign:${id}`, b.coins, ref);
      })
      .catch((e: any) => {
        // Same key, same campaign: the first call already landed. Answering with the current
        // budget is the honest reply — the caller asked for this credit and it is there.
        if (e.code === 'P2002' && key) return;
        throw e;
      });
    // Money entered the system without a payment record; the ledger alone does not say who
    // asked for it. This is also the admin's notification that it happened (see
    // `GET /v1/admin/notifications`), so it carries the budget it landed on and not just the
    // delta — "+5000" is a number an operator then has to go and look up.
    const budget = await balance(`campaign:${id}`);
    await audit(s.org_id, 'campaign.fund', `campaign:${id}`, { coins: b.coins, budget });
    return { budget };
  }

  @Patch('campaigns/:id')
  async patchCampaign(
    @Session() s: SessionClaims,
    @Param('id') id: string,
    @Body() b: { name?: string; status?: string },
  ) {
    await this.promoterCampaign(s.org_id, id);
    // Absent = leave unchanged, same shape as `PATCH orgs/me`, so a rename does not have to
    // restate the status (and quietly reactivate an ended campaign) to change the name.
    const data: { name?: string; status?: string } = {};
    if ('name' in b) data.name = str(b.name, 'name', 120)!;
    if ('status' in b) {
      if (!['active', 'paused', 'ended'].includes(b.status!))
        throw new BadRequestException('status must be active|paused|ended');
      data.status = b.status;
    }
    if (!Object.keys(data).length) throw new BadRequestException('nothing to update');
    const updated = await prisma.campaign.update({ where: { id }, data });
    // Audited for the same reason funding is: it is a tenant changing something the platform is
    // answerable for, and the admin's inbox is built out of exactly those entries.
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
    };
  }

  /**
   * Where this campaign's scans came from — the reason a promoter funds a second print run.
   *
   * Read-only for both sides, like `stats`. `ownedCampaign` is the whole authorisation story:
   * it throws unless the session is one of the two orgs on the partnership, so the id can never
   * read a stranger's traffic.
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
    const qr = await this.updateOwnQr(s.org_id, id, { voided: true });
    // Killing a code is the one QR action worth an admin's attention — a print run just stopped
    // working, and the support call about it arrives before anyone thinks to check a log.
    // Issuing and restyling codes are routine and stay out of the inbox on purpose.
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
    return rows.map((q) => ({ ...q, scan_url: `${BASE_URL}/r/${q.code}` }));
  }

  // ---------- publisher settings ----------

  /**
   * Both machine callers rotate their key here. A publisher's key earns fees on
   * `/v1/attribution/*`; a promoter's mints transaction codes on `/v1/issue` — opposite ends
   * of the same relationship, same credential, same one-call revocation.
   */
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
        deeplink_url: true,
        bonus_label: true,
        suspended: true,
        approved: true,
      },
    });
    // Every fee a publisher has earned lands in `publisher:{org_id}`; the admin portal could
    // read it and the publisher could not. Same number, own tenant. `withdrawable` is the
    // slice of it that has cleared the settlement window and is not already queued.
    return org.type === 'publisher'
      ? {
          ...org,
          earnings: await balance(`publisher:${org.id}`),
          withdrawable: await prisma.$transaction((tx) => withdrawable(tx, org.id)),
        }
      : org;
  }

  /**
   * Where scans go, and what the publisher says it gives new users. Absent = leave unchanged;
   * an explicit `""` or `null` clears the field.
   *
   * Publishers only: these are the five fields the scan redirect reads off the *publisher*
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
      /** an https origin claimed as an Android App Link / iOS Universal Link */
      deeplink_url?: string;
      bonus_label?: string;
    },
  ) {
    if (s.type !== 'publisher') throw new ForbiddenException('publishers only');
    const fields = {
      landing_url: validateLandingUrl(b.landing_url),
      android_package: validateAndroidPackage(b.android_package),
      ios_app_id: validateIosAppId(b.ios_app_id),
      deeplink_url: validateDeeplinkUrl(b.deeplink_url),
      bonus_label: validateBonusLabel(b.bonus_label),
    };
    // Filter on whether the key was *sent*, not on the validated value: every validator
    // returns null for a cleared field too, so filtering on the value made clearing impossible.
    const data = Object.fromEntries(Object.entries(fields).filter(([k]) => k in b));
    // Where every scan on this publisher's codes lands. A promoter's whole print run follows
    // this field, so the platform is answerable for a change to it even though it is the
    // publisher's own to make.
    const updated = await prisma.org.update({
      where: { id: s.org_id },
      data,
      select: {
        id: true,
        name: true,
        type: true,
        landing_url: true,
        android_package: true,
        ios_app_id: true,
        deeplink_url: true,
        bonus_label: true,
      },
    });
    // After the write, like every other notification here: an entry for a change that was
    // rejected is an inbox item about something that never happened.
    await audit(s.org_id, 'org.patch', `org:${s.org_id}`, data);
    return updated;
  }

  // ---------- withdrawals (publisher money-out) ----------

  /**
   * Ask for earned fees to be paid out. A request, not a transfer: the ledger only moves when
   * an admin pays it, and the amount is capped at what has cleared the settlement window —
   * which is the platform's fraud-review clawback period, not a cashflow convenience.
   */
  @Post('withdrawals')
  async requestWithdrawal(@Session() s: SessionClaims, @Body() b: { coins: number }) {
    if (s.type !== 'publisher') throw new ForbiddenException('publishers only');
    if (!Number.isInteger(b.coins) || b.coins < 1 || b.coins > 10_000_000)
      throw new BadRequestException('coins must be 1–10000000');
    const created = await prisma.$transaction(async (tx) => {
      // `withdrawable` locks the balance row, so two concurrent requests serialise here and
      // the second is judged against a pool the first has already claimed from.
      const available = await withdrawable(tx, s.org_id);
      if (b.coins > available)
        throw new BadRequestException(
          `only ${available} coins are withdrawable — the rest is still inside the settlement window`,
        );
      return tx.withdrawal.create({ data: { publisher_org_id: s.org_id, coins: b.coins } });
    });
    // Tenant actor, so it lands in the admin inbox — a payout request is exactly the kind of
    // thing an operator must see before it goes stale.
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
      include: { campaign: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
      take: capped(limit ?? '100'),
    });
    return rows.map(({ campaign, ...r }) => ({ ...r, campaign_name: campaign.name }));
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Bonus } from '../../common/attribution';
import { Rates } from '../../common/rates';
import { scanAnalytics } from '../../common/analytics';
import { audit, balance, balances, ledger, lockedBalance } from '../../common/ledger';
import { PrismaService, Tx } from '../../config/prisma';

/**
 * Data access only. The five `$transaction` methods throw their own domain exceptions — their
 * guards must run inside the tx to be serialised. `audit()` stays outside: `org:{id}` is not an FK.
 */

/** Only the columns `PATCH /orgs/:id` may write; presence of a key is what makes it written. */
export interface OrgPatch {
  suspended?: boolean;
  approved?: boolean;
  name?: string;
  landing_url?: string | null;
  deeplink_url?: string | null;
  android_package?: string | null;
  ios_app_id?: string | null;
  bonuses?: Bonus[];
}

/** The post-patch rate set from `validateRates`, plus the admin-only and proposal-clearing keys. */
export interface PartnershipPatch extends Rates {
  platform_fee_bps?: number;
  status?: string;
  proposed_coin_rate?: null;
  proposed_guest_rate?: null;
  proposed_engagement_rate?: null;
}

export interface QrCodePatch {
  expires_at?: Date | null;
  max_uses?: number | null;
  voided?: boolean;
}

/** Admins are not tenants: no admin org is listable, patchable, deletable or offboardable. */
const NOT_ADMIN = { type: { not: 'admin' } } as const;

const ORG_LIST_SELECT = {
  id: true,
  name: true,
  type: true,
  email: true,
  landing_url: true,
  suspended: true,
  approved: true,
  created_at: true,
  api_key_hash: true,
} as const;

const ORG_DETAIL_SELECT = {
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
} as const;

const ORG_NAMES = {
  promoter: { select: { name: true } },
  publisher: { select: { name: true } },
} as const;

@Injectable()
export class AdminRepository {
  constructor(private readonly db: PrismaService) {}

  // ---------------------------------------------------------------- shared money/audit access

  audit(actorOrgId: string | null, action: string, target: string, detail?: unknown) {
    return audit(actorOrgId, action, target, detail);
  }

  balance(account: string) {
    return balance(account);
  }

  balances(accounts: string[]) {
    return balances(accounts);
  }

  scanAnalytics(campaignId: string | null, days: number) {
    return scanAnalytics(campaignId, days);
  }

  // ------------------------------------------------------------------------------- dashboard

  /** One round trip for 27 aggregates; twenty-seven Prisma `count`s would be 27 queries. */
  async overview(): Promise<Record<string, number>> {
    const [o] = await this.db.$queryRaw<Record<string, number>[]>`
      SELECT
        (SELECT count(*)::int FROM orgs WHERE type='promoter')            AS promoters,
        (SELECT count(*)::int FROM orgs WHERE type='publisher')           AS publishers,
        (SELECT count(*)::int FROM orgs WHERE suspended)                  AS suspended_orgs,
        (SELECT count(*)::int FROM partnerships)                          AS partnerships,
        (SELECT count(*)::int FROM partnerships WHERE status='pending')   AS pending_partnerships,
        (SELECT count(*)::int FROM campaigns)                             AS campaigns,
        (SELECT count(*)::int FROM campaigns WHERE status='active')       AS active_campaigns,
        (SELECT count(*)::int FROM campaigns WHERE mode='engagement')     AS engagement_campaigns,
        -- Split out: acquisition converts once per person ever, engagement once per purchase,
        -- so a blended conversion rate describes neither.
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
        -- Platform revenue: every payout's retained cut, accumulated.
        (SELECT coalesce(sum(amount),0)::int FROM ledger_entries WHERE account='platform:fees') AS platform_revenue,
        (SELECT coalesce(sum(amount),0)::int FROM ledger_entries WHERE account='external:payouts') AS total_paid_out,
        (SELECT count(*)::int FROM withdrawals WHERE status='requested')  AS open_withdrawals,
        (SELECT count(*)::int FROM orgs WHERE type='publisher' AND NOT approved AND NOT suspended) AS unapproved_publishers,
        (SELECT count(*)::int FROM payments WHERE status='pending')       AS pending_payments,
        (SELECT coalesce(sum(amount),0)::int FROM ledger_entries)         AS ledger_sum,
        -- ledger_sum=0 only proves the book is double-entry; this catches cached account_balances
        -- rows (which every money path locks and reads) drifting from their entries.
        -- ponytail: aggregates the whole ledger — move to a scheduled reconciliation job once big.
        (SELECT count(*)::int FROM account_balances b
           LEFT JOIN (SELECT account, sum(amount)::int AS s FROM ledger_entries GROUP BY account) e
             ON e.account = b.account
          WHERE b.balance <> coalesce(e.s, 0))                            AS drifted_accounts,
        -- Badge count for the same unacknowledged tenant-action slice GET /notifications serves.
        (SELECT count(*)::int FROM audit_log a
           JOIN orgs ao ON ao.id = a.actor_org_id
          WHERE a.acknowledged_at IS NULL AND ao.type <> 'admin')          AS open_notifications`;
    return o;
  }

  // ------------------------------------------------------------------------------------- orgs

  listOrgs(q: string | undefined, take: number) {
    return this.db.org.findMany({
      take,
      where: {
        ...NOT_ADMIN,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { email: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: ORG_LIST_SELECT,
      orderBy: { created_at: 'desc' },
    });
  }

  // Raw because campaigns hang off either side of a partnership (two FKs on one table), which
  // Prisma cannot `_count`; ledger history is matched on the `publisher:{id}` account string.
  orgCampaignCounts() {
    return this.db.$queryRaw<{ org_id: string; n: number; has_history: boolean }[]>`
      SELECT o.id AS org_id, count(c.id)::int AS n,
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
      GROUP BY o.id`;
  }

  /** Returns rows affected, so a 404 and a no-op patch stay distinguishable to the caller. */
  async patchOrg(id: string, data: OrgPatch): Promise<number> {
    const { count } = await this.db.org.updateMany({ where: { id, ...NOT_ADMIN }, data });
    return count;
  }

  findOrg(id: string) {
    return this.db.org.findUnique({ where: { id }, select: ORG_DETAIL_SELECT });
  }

  async setApiKeyHash(id: string, api_key_hash: string): Promise<number> {
    const { count } = await this.db.org.updateMany({
      where: { id, ...NOT_ADMIN },
      data: { api_key_hash },
    });
    return count;
  }

  async setResetToken(id: string, hash: string, expires: Date): Promise<number> {
    const { count } = await this.db.org.updateMany({
      where: { id, ...NOT_ADMIN },
      data: { reset_token_hash: hash, reset_token_expires: expires },
    });
    return count;
  }

  // Atomic: separate statements would leave a window where a departed tenant still has access or
  // coin-grant capability.
  offboard(id: string) {
    return this.db.$transaction(async (tx) => {
      const suspended = await tx.org.updateMany({
        where: { id, ...NOT_ADMIN },
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
  }

  // The only allowed deletion: an org that never traded (everything else is `offboard`). The
  // ledger is append-only and holds the org id in an opaque `account` string, not an FK.
  deleteOrg(id: string) {
    return this.db.$transaction(async (tx) => {
      const o = await tx.org.findUnique({
        where: { id },
        select: { id: true, name: true, type: true, email: true },
      });
      // Admin and missing both 404 — a caller cannot tell which it hit.
      if (!o || o.type === 'admin') throw new NotFoundException('org not found');

      // Inside the tx, else a partnership created mid-request survives the delete. ON DELETE
      // RESTRICT covers three of the four; `ledger_entries` has no FK, so it needs the guard.
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
  }

  // ------------------------------------------------------------------------------ partnerships

  listPartnerships(take: number) {
    return this.db.partnership.findMany({
      include: ORG_NAMES,
      orderBy: { created_at: 'desc' },
      take,
    });
  }

  findPartnership(id: string) {
    return this.db.partnership.findUnique({ where: { id } });
  }

  updatePartnership(id: string, data: PartnershipPatch) {
    return this.db.partnership.update({ where: { id }, data });
  }

  // --------------------------------------------------------------------------------- campaigns

  listCampaigns(take: number) {
    return this.db.campaign.findMany({
      take,
      include: {
        partnership: {
          select: { coin_rate: true, engagement_rate: true, ...ORG_NAMES },
        },
        _count: { select: { scans: true, redemptions: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  findCampaign(id: string) {
    return this.db.campaign.findUnique({ where: { id } });
  }

  campaignExists(id: string) {
    return this.db.campaign.findUnique({ where: { id }, select: { id: true } });
  }

  async setCampaignStatus(id: string, status: string): Promise<number> {
    const { count } = await this.db.campaign.updateMany({ where: { id }, data: { status } });
    return count;
  }

  /** Kill switch: end the campaign and void every code it ever issued, in one call. */
  killCampaign(id: string) {
    return this.db.$transaction(async (tx) => {
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
  }

  // Floor check is here, not the service: outside the row lock two concurrent clawbacks would both
  // pass `>= 0`. With a key, a double submit collides on `UNIQUE (account, ref)` and is swallowed.
  adjustBudget(campaignId: string, coins: number, key?: string) {
    return this.db
      .$transaction(async (tx: Tx) => {
        if ((await lockedBalance(tx, `campaign:${campaignId}`)) + coins < 0)
          throw new BadRequestException('adjustment would push budget below zero');
        const ref = `admin-adjust:${campaignId}:${key ?? Date.now()}`;
        await ledger(tx, 'external:funding', -coins, ref);
        await ledger(tx, `campaign:${campaignId}`, coins, ref);
      })
      .catch((e: any) => {
        if (e.code === 'P2002' && key) return; // already applied under this key
        throw e;
      });
  }

  // ---------------------------------------------------------------------------------- qr codes

  listQrCodes(take: number) {
    return this.db.qrCode.findMany({
      take,
      select: {
        id: true,
        code: true,
        created_at: true,
        expires_at: true,
        max_uses: true,
        uses: true,
        voided: true,
        // Promoter's own reference (PNR, order number) so support can search by it; NULL for
        // portal-designed codes, set only on machine-issued ones.
        issued_ref: true,
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
  }

  async patchQrCode(id: string, data: QrCodePatch): Promise<number> {
    const { count } = await this.db.qrCode.updateMany({ where: { id }, data });
    return count;
  }

  findQrCode(id: string) {
    return this.db.qrCode.findUnique({ where: { id } });
  }

  // ----------------------------------------------------------------- notifications / audit log

  // The unacknowledged, tenant-authored end of the audit log — the actor filter is the whole rule,
  // so any newly audited tenant action shows up here for free.
  listNotifications(take: number) {
    return this.db.auditLog.findMany({
      where: { acknowledged_at: null, actor: NOT_ADMIN },
      include: { actor: { select: { name: true, email: true, type: true } } },
      orderBy: { created_at: 'desc' },
      take,
    });
  }

  async acknowledgeNotifications(ids?: string[]): Promise<number> {
    const { count } = await this.db.auditLog.updateMany({
      // Same slice the inbox reads: never admin's own entries, never re-dating a handled one.
      where: {
        acknowledged_at: null,
        actor: NOT_ADMIN,
        ...(ids ? { id: { in: ids } } : {}),
      },
      data: { acknowledged_at: new Date() },
    });
    return count;
  }

  listAuditLog(take: number) {
    return this.db.auditLog.findMany({
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { created_at: 'desc' },
      take,
    });
  }

  // ------------------------------------------------------------------------- scans/redemptions

  listScans(campaignId: string | undefined, take: number) {
    return this.db.scan.findMany({
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
        // Hand-off screen behaviour: `exit: 'auto'` on iOS means nobody tapped, so nothing was
        // carried and the install could never be attributed.
        client: true,
        consumed: true,
        qr_code: { select: { code: true } },
        // Plural: a scan by somebody with no app pays twice, as acquisition and as purchase.
        redemptions: { select: { coins: true, match_method: true, kind: true } },
        campaign: {
          select: { id: true, name: true, partnership: { select: ORG_NAMES } },
        },
      },
      orderBy: { scanned_at: 'desc' },
      take,
    });
  }

  listRedemptions(take: number) {
    return this.db.redemption.findMany({
      include: { campaign: { select: { name: true, partnership: { select: ORG_NAMES } } } },
      orderBy: { created_at: 'desc' },
      take,
    });
  }

  // ------------------------------------------------------------------------------- withdrawals

  listWithdrawals(status: string | undefined, take: number) {
    return this.db.withdrawal.findMany({
      where: status ? { status } : {},
      include: { publisher: { select: { name: true, email: true } } },
      orderBy: { requested_at: 'desc' },
      take,
    });
  }

  // Real money leaving. Status is flipped by the same UPDATE that tests it, so two admins paying
  // at once move it once; the locked balance read stops paying over a clawback that landed since.
  payWithdrawal(id: string, note: string | null) {
    return this.db.$transaction(async (tx: Tx) => {
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
  }

  async rejectWithdrawal(id: string, note: string | null): Promise<number> {
    const { count } = await this.db.withdrawal.updateMany({
      where: { id, status: 'requested' },
      data: { status: 'rejected', note, decided_at: new Date() },
    });
    return count;
  }

  findWithdrawal(id: string) {
    return this.db.withdrawal.findUnique({ where: { id } });
  }

  // ------------------------------------------------------------------------------------ ledger

  ledgerPage(account: string | undefined, take: number) {
    return Promise.all([
      this.db.ledgerEntry.findMany({
        where: account ? { account } : {},
        orderBy: { created_at: 'desc' },
        take,
      }),
      this.db.accountBalance.findMany({ orderBy: { account: 'asc' } }),
    ]);
  }
}

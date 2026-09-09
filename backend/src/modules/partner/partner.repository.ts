import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { lockedBalance, payout } from '../../common/ledger';
import { REFERRER_WINDOW_DAYS, SIGNUP_WINDOW_DAYS } from '../../config';
import { PrismaService, Tx } from '../../config/prisma';

/**
 * Every read and write the Partner API performs — no response shaping, bonuses or logging. The
 * transactional units, `Rollback` and the `P2002` mapping live here because each is a transaction
 * concern: guards serialise only alongside their write, a refusal after the guard flips must unwind
 * or it burns the install, and `P2002` means a different replay per statement.
 */

export type MatchMethod = 'referrer' | 'appclip' | 'pasteboard';

export interface Carried {
  claimId: string | null;
  carrier: MatchMethod;
}

/** Alias, not an interface: Prisma's `Json` input needs the implicit index signature only aliases carry. */
export type DeviceRisk = {
  emulator: boolean;
  rooted: boolean;
  vpn: boolean;
};

export interface ClaimableScan {
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

export interface ClaimableCode {
  qr_code_id: string;
  scan_id: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  bonus_types: string[];
  engagement_rate: number;
  platform_fee_bps: number;
}

type Match =
  | { scan: ClaimableScan; confidence: number; match_method: MatchMethod }
  | { reason: string; confidence?: number };

export type BindResult =
  | { status: 'unattributed'; reason: string; confidence?: number }
  | {
      status: 'attributed';
      install_id: string;
      scan: ClaimableScan;
      match_method: MatchMethod;
      confidence: number;
      expires_at: Date;
    };

export type AcquisitionResult =
  | { status: 'unattributed'; reason: string }
  /** the UNIQUE fired: already counted, so the prior row is the honest answer */
  | { status: 'replay'; campaign_id: string }
  | {
      status: 'attributed';
      redemption_id: string;
      scan: ClaimableScan;
      match_method: MatchMethod;
      confidence: number;
      identified: boolean;
      fee: number;
      net: number;
      cut: number;
    };

export type EngagementResult =
  | { status: 'unattributed'; reason: string }
  | { status: 'replay'; qr_code_id: string }
  | {
      status: 'attributed';
      redemption_id: string;
      match: ClaimableCode;
      fee: number;
      net: number;
      cut: number;
    };

export type ConfirmResult =
  | { status: 'already_full'; id: string; fee: number }
  | { status: 'confirmed'; id: string; fee: number; fee_added: number };

/** Unattributed, but unwind: `claimInstall`/`claimAtSignup` flip their guard before the budget is
 *  known, so returning normally would permanently burn an install that came up short. */
class Rollback extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

@Injectable()
export class PartnerRepository {
  constructor(private readonly db: PrismaService) {}

  // ------------------------------------------------------------------------------- matching

  // SKIP LOCKED, not plain FOR UPDATE: a concurrent claim must return unattributed, not queue and re-process the row.
  private byClaimId(tx: Tx, publisherId: string, claimId: string) {
    return tx.$queryRaw<ClaimableScan[]>`
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
  }

  // Find the scan this install came from, or refuse. No fallback by design — gone, already claimed
  // and another publisher's all answer `no_match`. `confidence` is always 100, kept for API compatibility.
  private async matchScan(tx: Tx, publisherId: string, carried: Carried): Promise<Match> {
    if (!carried.claimId) return { reason: 'no_claim' };
    const rows = await this.byClaimId(tx, publisherId, carried.claimId);
    return rows[0]
      ? { scan: rows[0], confidence: 100, match_method: carried.carrier }
      : { reason: 'no_match' };
  }

  // Preferred signup path: matched at first open, so this only checks the install is still spendable.
  // `redeemed` flips inside the `updateMany` that tests it; the scan is deliberately not re-matched.
  private async claimInstall(tx: Tx, publisherId: string, installId: string): Promise<Match> {
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
    // Re-checked, not just at first open: pausing a campaign must stop spending immediately.
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

  // Engagement path: one code per real purchase, paid once. `scans.consumed` deliberately unchecked —
  // that is the acquisition guard; both rewards pay on one scan, and engagement has its own partial unique index.
  private async claimCode(
    tx: Tx,
    publisherId: string,
    code: string,
  ): Promise<ClaimableCode | { reason: string }> {
    // `FOR UPDATE OF q` serialises two simultaneous claims here, rather than letting both reach the INSERT.
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
    // One answer for unknown, voided, another publisher's and unscanned codes on purpose: telling them
    // apart would let a publisher probe the whole platform.
    if (!row) return { reason: 'no_match' };
    if (row.mode !== 'engagement') return { reason: 'not_engagement' };
    if (row.status !== 'active') return { reason: 'campaign_not_active' };
    return row;
  }

  // Legacy single-call path: match and pay in one request, no install row. Kept for already-integrated publishers.
  private async claimAtSignup(tx: Tx, publisherId: string, carried: Carried): Promise<Match> {
    const m = await this.matchScan(tx, publisherId, carried);
    if ('reason' in m) return m;
    if (m.scan.status !== 'active') return { reason: 'campaign_not_active' };

    // No install row, so the scan itself is the guard — same atomic test-and-set.
    const consumed = await tx.scan.updateMany({
      where: { id: m.scan.id, consumed: false },
      data: { consumed: true },
    });
    if (!consumed.count) return { reason: 'already_claimed' };
    return m;
  }

  // ------------------------------------------------------------------------------- first open

  /**
   * Consume the scan and bind an install. Nothing is paid, the budget is only tested: a campaign
   * that cannot afford the guest tier binds nothing rather than burning the scan on a doomed signup.
   */
  bindInstall(
    publisherId: string,
    carried: Carried,
    risk: DeviceRisk,
  ): Promise<BindResult> {
    return this.db.$transaction(async (tx: Tx): Promise<BindResult> => {
      const m = await this.matchScan(tx, publisherId, carried);
      if ('reason' in m)
        return { status: 'unattributed', reason: m.reason, confidence: m.confidence };
      const { scan, confidence, match_method } = m;
      if (scan.status !== 'active')
        return { status: 'unattributed', reason: 'campaign_not_active' };

      // Bind nothing against a campaign that cannot pay: the signup would fail on budget having burned the scan.
      if ((await lockedBalance(tx, `campaign:${scan.campaign_id}`)) < scan.guest_rate)
        return { status: 'unattributed', reason: 'budget_exhausted' };

      // One install per scan, independent of the matcher's lock rather than relying on it.
      const consumed = await tx.scan.updateMany({
        where: { id: scan.id, consumed: false },
        data: { consumed: true },
      });
      if (!consumed.count) return { status: 'unattributed', reason: 'already_claimed' };

      const expires_at = new Date(Date.now() + SIGNUP_WINDOW_DAYS * 86_400_000);
      const install = await tx.install.create({
        data: {
          scan_id: scan.id,
          campaign_id: scan.campaign_id,
          publisher_org_id: publisherId,
          match_method,
          confidence,
          risk,
          expires_at,
        },
        select: { id: true },
      });

      return {
        status: 'attributed',
        install_id: install.id,
        scan,
        match_method,
        confidence,
        expires_at,
      };
    });
  }

  // ------------------------------------------------------------------------------ acquisition

  /** Match, count the signup and pay, in one transaction. `install_id` is preferred; `carried` is legacy. */
  async recordAcquisition(
    publisherId: string,
    args: {
      install_id: string | null;
      carried: Carried | null;
      publisher_user_ref: string;
      identified: boolean;
    },
  ): Promise<AcquisitionResult> {
    const { install_id, carried, publisher_user_ref, identified } = args;
    // Set when the UNIQUE below fires: no query can run in an aborted Postgres transaction.
    let replayCampaignId: string | null = null;

    const fresh = await this.db
      .$transaction(async (tx: Tx): Promise<AcquisitionResult> => {
        const resolved = install_id
          ? await this.claimInstall(tx, publisherId, install_id)
          : await this.claimAtSignup(tx, publisherId, carried!);
        if ('reason' in resolved) return { status: 'unattributed', reason: resolved.reason };
        const { scan, confidence, match_method } = resolved;

        const fee = identified ? scan.coin_rate : scan.guest_rate;

        // Fail closed, thrown so the install/scan is released (see `Rollback`), and unattributed
        // rather than an error because the user has already signed up.
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
          // UNIQUE (campaign_id, publisher_user_ref): already counted. Roll back so the scan is not left consumed.
          if (e.code === 'P2002') {
            replayCampaignId = scan.campaign_id;
            throw new ConflictException('duplicate_user');
          }
          throw e;
        }

        const ref = `redemption:${red.id}`;
        const { net, cut } = await payout(
          tx, scan.campaign_id, publisherId, fee, scan.platform_fee_bps, ref,
        );

        return {
          status: 'attributed',
          redemption_id: red.id,
          scan,
          match_method,
          confidence,
          identified,
          fee,
          net,
          cut,
        };
      })
      .catch((e): AcquisitionResult | null => {
        // Rolled back on purpose: still a 200, and the install stays claimable.
        if (e instanceof Rollback) return { status: 'unattributed', reason: e.reason };
        if (replayCampaignId) return null; // handled by the caller, as a replay rather than an error
        throw e;
      });

    if (fresh) return fresh;
    return { status: 'replay', campaign_id: replayCampaignId! };
  }

  /**
   * The row a replayed acquisition answers from. `kind` matches the PARTIAL unique index predicate —
   * without it Postgres cannot prove the index applies, and an unscoped findFirst can return the
   * engagement row for a user with both: wrong fee, and `/confirm` answers `already_full`.
   */
  priorAcquisition(campaignId: string, publisher_user_ref: string) {
    return this.db.redemption.findFirst({
      where: { campaign_id: campaignId, publisher_user_ref, kind: 'acquisition' },
      include: {
        campaign: {
          select: {
            name: true,
            bonus_types: true,
            partnership: {
              select: { coin_rate: true, grace_days: true, platform_fee_bps: true },
            },
          },
        },
      },
    });
  }

  // ------------------------------------------------------------------------------- engagement

  /**
   * Engagement payout: a repeat purchase, paid on the code that proves it. Shares the budget lock,
   * ledger, rollback-on-refusal and replay-never-re-pay with acquisition. No guest tier — a repeat
   * customer already transacted with the promoter.
   */
  async recordEngagement(
    publisherId: string,
    code: string,
    publisher_user_ref: string,
  ): Promise<EngagementResult> {
    let replayQrCodeId: string | null = null;

    const fresh = await this.db
      .$transaction(async (tx: Tx): Promise<EngagementResult> => {
        const m = await this.claimCode(tx, publisherId, code);
        if ('reason' in m) return { status: 'unattributed', reason: m.reason };

        const fee = m.engagement_rate;
        // Fail closed, thrown so the transaction unwinds and the code stays claimable.
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
              // Settled on write: nothing held back for `/confirm` to release.
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
          tx, m.campaign_id, publisherId, fee, m.platform_fee_bps, ref,
        );

        return { status: 'attributed', redemption_id: red.id, match: m, fee, net, cut };
      })
      .catch((e): EngagementResult | null => {
        if (e instanceof Rollback) return { status: 'unattributed', reason: e.reason };
        if (replayQrCodeId) return null; // handled by the caller, as a replay rather than an error
        throw e;
      });

    if (fresh) return fresh;
    return { status: 'replay', qr_code_id: replayQrCodeId! };
  }

  priorEngagement(qrCodeId: string) {
    return this.db.redemption.findFirst({
      where: { qr_code_id: qrCodeId, kind: 'engagement' },
      include: {
        campaign: {
          select: {
            name: true,
            bonus_types: true,
            partnership: { select: { platform_fee_bps: true } },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------------- confirm

  /**
   * Release the held-back part of a guest-tier fee. Idempotent; domain refusals are thrown from
   * inside the transaction because only under `FOR UPDATE OF rd` are the guards serialised.
   */
  confirm(publisherId: string, id: string): Promise<ConfirmResult> {
    return this.db.$transaction(async (tx: Tx): Promise<ConfirmResult> => {
      // Raw because `FOR UPDATE OF rd` locks the attribution row across the join, making a concurrent double-confirm safe.
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
        WHERE rd.id = ${id}::uuid AND p.publisher_org_id = ${publisherId}::uuid
        FOR UPDATE OF rd`;
      const red = rows[0];
      if (!red) throw new NotFoundException('attribution not found');
      // Suspending a partnership must stop payouts too; surfaced as a reason rather than filtered
      // out, so it does not read like a lost attribution.
      if (red.partnership_status !== 'active')
        throw new ConflictException('partnership_not_active');
      if (red.identified) return { status: 'already_full', id: red.id, fee: red.coins };

      const deadline = new Date(red.created_at).getTime() + red.grace_days * 86_400_000;
      if (Date.now() > deadline) throw new ConflictException('grace_period_expired');

      const delta = red.coin_rate - red.coins;
      if (delta > 0) {
        if ((await lockedBalance(tx, `campaign:${red.campaign_id}`)) < delta)
          throw new ConflictException('budget_exhausted');
        // Same split as the guest payment, so the cut lands on the whole coin_rate.
        await payout(tx, red.campaign_id, publisherId, delta, red.platform_fee_bps, `upgrade:${red.id}`);
      }
      await tx.redemption.update({
        where: { id: red.id },
        data: { coins: red.coin_rate, identified: true, upgraded_at: new Date() },
      });
      return { status: 'confirmed', id: red.id, fee: red.coin_rate, fee_added: delta };
    });
  }

  // -------------------------------------------------------------------------------- lookup

  findAttribution(publisherId: string, id: string) {
    return this.db.redemption.findFirst({
      where: { id, campaign: { partnership: { publisher_org_id: publisherId } } },
    });
  }
}

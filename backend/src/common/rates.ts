import { BadRequestException } from '@nestjs/common';

/**
 * The four numbers a partnership is priced on, validated in one place.
 *
 * They were checked twice — once where a promoter requests a partnership, once where an admin
 * patches one — and the two copies had already drifted (different bounds on `guest_rate`,
 * different messages for the same rule). A money rule with two implementations is a money rule
 * with two answers, and the next rate field added would have been added to only one of them.
 * `engagement_rate` is that next field, and it went in here once.
 *
 * `guest_rate <= coin_rate` is also a CHECK constraint in the database. That is the real
 * guarantee; this exists so the caller gets a message it can act on instead of a driver error.
 */

const DEFAULTS = { coin_rate: 50, grace_days: 7, engagement_rate: 20 };

function int(v: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max)
    throw new BadRequestException(`${name} must be an integer ${min}–${max}`);
  return v as number;
}

export interface Rates {
  coin_rate: number;
  guest_rate: number;
  grace_days: number;
  /** what one repeat purchase pays in an `engagement` campaign */
  engagement_rate: number;
}

/**
 * Resolve a patch against what is already there. Omit `current` to resolve against the
 * platform defaults instead, which is what creating a partnership does.
 *
 * Returns the full post-patch triple rather than only the changed fields, so the caller
 * writes a set of values that has been checked *together* — the pair rule cannot be satisfied
 * by either field alone.
 */
export function validateRates(patch: Partial<Rates>, current?: Rates): Rates {
  const coin_rate =
    patch.coin_rate === undefined
      ? (current?.coin_rate ?? DEFAULTS.coin_rate)
      : int(patch.coin_rate, 'coin_rate', 1, 100_000);
  const guest_rate =
    patch.guest_rate === undefined
      ? // On creation the guest tier defaults to a token rate, never above the coin rate.
        (current?.guest_rate ?? Math.min(10, coin_rate))
      : int(patch.guest_rate, 'guest_rate', 0, 100_000);
  const grace_days =
    patch.grace_days === undefined
      ? (current?.grace_days ?? DEFAULTS.grace_days)
      : int(patch.grace_days, 'grace_days', 0, 365);
  // Not bounded against `coin_rate`, on purpose. The guest rate is a *part* of the coin rate —
  // the held-back delta is what makes the two-tier payout work, so it cannot exceed it. A
  // repeat purchase is not part of an acquisition; it is a different thing being bought, and a
  // partnership may honestly price it above a signup or at a tenth of one.
  const engagement_rate =
    patch.engagement_rate === undefined
      ? (current?.engagement_rate ?? DEFAULTS.engagement_rate)
      : int(patch.engagement_rate, 'engagement_rate', 0, 100_000);
  if (guest_rate > coin_rate)
    throw new BadRequestException('guest_rate cannot exceed coin_rate');
  return { coin_rate, guest_rate, grace_days, engagement_rate };
}

/**
 * Split a gross payout into the publisher's net and the platform's cut, in basis points.
 *
 * Pure and in one place for the same reason `validateRates` is: this is the platform's
 * revenue, and two call sites rounding differently is a ledger that fails to sum to zero.
 * `floor` on the cut so rounding always favours the publisher — the party being paid for
 * work, and the one who would notice a missing coin.
 */
export function splitFee(gross: number, bps: number): { net: number; cut: number } {
  const cut = Math.floor((gross * bps) / 10_000);
  return { net: gross - cut, cut };
}

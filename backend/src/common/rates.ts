import { BadRequestException } from '@nestjs/common';

// Partnership pricing validated in one place — a money rule with two implementations has two
// answers. `guest_rate <= coin_rate` is also a DB CHECK; here it yields an actionable message.

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

/** Resolve a patch against `current`, or against platform defaults on create. Returns the whole
 *  post-patch set, so the pair rule cannot be half-satisfied by a partial write. */
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
  // Deliberately unbounded against `coin_rate`: a repeat purchase may honestly cost more or less.
  const engagement_rate =
    patch.engagement_rate === undefined
      ? (current?.engagement_rate ?? DEFAULTS.engagement_rate)
      : int(patch.engagement_rate, 'engagement_rate', 0, 100_000);
  if (guest_rate > coin_rate)
    throw new BadRequestException('guest_rate cannot exceed coin_rate');
  return { coin_rate, guest_rate, grace_days, engagement_rate };
}

/** Split gross into net and cut (basis points). One place, because two call sites rounding
 *  differently is a ledger that fails to sum to zero. `floor` the cut so rounding favours net. */
export function splitFee(gross: number, bps: number): { net: number; cut: number } {
  const cut = Math.floor((gross * bps) / 10_000);
  return { net: gross - cut, cut };
}

import { BadRequestException } from '@nestjs/common';

/**
 * The three numbers a partnership is priced on, validated in one place.
 *
 * They were checked twice — once where a promoter requests a partnership, once where an admin
 * patches one — and the two copies had already drifted (different bounds on `guest_rate`,
 * different messages for the same rule). A money rule with two implementations is a money rule
 * with two answers, and the next rate field added would have been added to only one of them.
 *
 * `guest_rate <= coin_rate` is also a CHECK constraint in the database. That is the real
 * guarantee; this exists so the caller gets a message it can act on instead of a driver error.
 */

const DEFAULTS = { coin_rate: 50, grace_days: 7 };

function int(v: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max)
    throw new BadRequestException(`${name} must be an integer ${min}–${max}`);
  return v as number;
}

export interface Rates {
  coin_rate: number;
  guest_rate: number;
  grace_days: number;
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
  if (guest_rate > coin_rate)
    throw new BadRequestException('guest_rate cannot exceed coin_rate');
  return { coin_rate, guest_rate, grace_days };
}

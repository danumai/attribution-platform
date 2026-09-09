import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, NotContains } from 'class-validator';
import { capped } from '../paging';

/**
 * The row ceiling, declared once instead of at each of the sixteen `capped(limit)` call sites it
 * used to be spelled at. `capped` still owns the clamp — including the reason it clamps the low
 * end, which is that Prisma reads a negative `take` as "last N, reversed".
 *
 * The default lands here rather than in the handler, which needs `@Expose()`: class-transformer
 * takes its key list from the *incoming object*, so a `@Transform` on an absent parameter never
 * runs — `limit` would arrive undefined and fail `@IsInt()` on every unparameterised list call.
 * `@Expose()` adds the key to that list, which is its only job here; the default `exposeAll`
 * strategy makes it a no-op otherwise.
 */
export function CappedLimit(fallback?: number) {
  return (target: object, key: string) => {
    ApiPropertyOptional({ minimum: 1, maximum: 1000, default: fallback ?? 200 })(target, key);
    Expose()(target, key);
    Transform(({ value }) =>
      value === undefined && fallback !== undefined ? fallback : capped(value),
    )(target, key);
    IsInt()(target, key);
  };
}

export class LimitQuery {
  @CappedLimit()
  limit!: number;
}

/**
 * The window `scanAnalytics` aggregates over. Shared by the admin console and the promoter's own
 * campaign page, which read the same function — an unbounded `days` on one of them is an
 * unbounded aggregate over the whole scan table.
 *
 * `@Expose()` for the same reason as `CappedLimit`: without it the transform is skipped when
 * `days` is absent, and the default never lands.
 */
export function DaysProperty(fallback = 30) {
  return (target: object, key: string) => {
    ApiPropertyOptional({ minimum: 1, maximum: 365, default: fallback })(target, key);
    Expose()(target, key);
    Transform(({ value }) =>
      value === undefined || value === '' ? fallback : Math.trunc(+value) || fallback,
    )(target, key);
    IsInt()(target, key);
    Min(1)(target, key);
    Max(365)(target, key);
  };
}

/** A bounded free-text query parameter — `q` is a `contains` filter, so it reaches the database. */
export function SearchProperty(max = 120) {
  return (target: object, key: string) => {
    ApiPropertyOptional({ maxLength: max })(target, key);
    IsOptional()(target, key);
    IsString()(target, key);
    NotContains('\0', { message: '$property must not contain null bytes' })(target, key);
    MaxLength(max)(target, key);
    Transform(({ value }) => (value === '' ? undefined : value))(target, key);
  };
}

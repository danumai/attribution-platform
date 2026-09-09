import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, NotContains } from 'class-validator';
import { capped } from '../paging';

/**
 * The row ceiling, declared once. `capped` owns the clamp, low end too (Prisma reads a negative
 * `take` as "last N, reversed"). `@Expose()` lists the key so an absent `limit` defaults, not 400s.
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
 * The window `scanAnalytics` aggregates over, bounded because admin and promoter pages share it and
 * an unbounded `days` aggregates the whole scan table. `@Expose()` as in `CappedLimit`.
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

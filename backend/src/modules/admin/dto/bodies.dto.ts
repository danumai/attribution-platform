import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotContains,
  NotEquals,
  ValidateIf,
} from 'class-validator';
import { AppTargetsDto } from '../../../common/dto/app-targets.dto';

/**
 * Why an admin overrode something, stored in the audit detail. Bounded because it lands in a JSONB
 * column that every notification listing renders.
 */
export function ReasonProperty(max = 300) {
  return (target: object, key: string) => {
    ApiPropertyOptional({ maxLength: max })(target, key);
    IsOptional()(target, key);
    IsString()(target, key);
    NotContains('\0', { message: '$property must not contain null bytes' })(target, key);
    MaxLength(max)(target, key);
    Transform(({ value }) => (value === '' ? undefined : value))(target, key);
  };
}

export class ReasonDto {
  @ReasonProperty()
  reason?: string;
}

export class PatchOrgDto extends AppTargetsDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  // Bounded: unbounded, one PATCH bloats the row and every listing that renders it.
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'suspended must be a boolean' })
  suspended?: boolean;

  /** the publisher-vetting gate: false hides the org from the directory and blocks new partnerships */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'approved must be a boolean' })
  approved?: boolean;

  @ReasonProperty()
  reason?: string;
}

export class PatchPartnershipDto {
  /**
   * The four negotiated numbers, with no range decorators on purpose: `validateRates` checks
   * `guest_rate <= coin_rate` post-patch, which needs the stored row. One money rule, one definition.
   */
  @ApiPropertyOptional({ minimum: 1, maximum: 100_000 })
  @IsOptional()
  @IsInt()
  coin_rate?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100_000 })
  @IsOptional()
  @IsInt()
  guest_rate?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  grace_days?: number;

  /** priced separately from the acquisition pair — see `validateRates` */
  @ApiPropertyOptional({ minimum: 0, maximum: 100_000 })
  @IsOptional()
  @IsInt()
  engagement_rate?: number;

  /**
   * Admin-only: the take rate is the platform's own side of the deal, so neither counterparty may
   * set it. Bounded here because nothing else defines it.
   */
  @ApiPropertyOptional({ minimum: 0, maximum: 10_000 })
  @IsOptional()
  @IsInt({ message: 'platform_fee_bps must be an integer 0–10000' })
  @Min(0, { message: 'platform_fee_bps must be an integer 0–10000' })
  @Max(10_000, { message: 'platform_fee_bps must be an integer 0–10000' })
  platform_fee_bps?: number;

  /**
   * `suspended`, not `pending`, is the pause lever: `pending` is the publisher's inbox state and it
   * can accept its way out of one, making an admin suspension revertible by its target.
   */
  @ApiPropertyOptional({ enum: ['pending', 'active', 'suspended'] })
  @IsOptional()
  @IsIn(['pending', 'active', 'suspended'], {
    message: 'status must be pending|active|suspended',
  })
  status?: string;
}

export class PatchCampaignDto {
  @ApiProperty({ enum: ['active', 'paused', 'ended'] })
  @IsIn(['active', 'paused', 'ended'], { message: 'status must be active|paused|ended' })
  status!: string;

  @ReasonProperty()
  reason?: string;
}

/**
 * Per-code override of the default expiry/single-use rules, e.g. permanent store signage. `null`
 * clears the limit and absent leaves it alone, so `@ValidateIf` — `@IsOptional()` skips null too.
 */
export class PatchQrCodeDto {
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  @ValidateIf((o) => o.expires_at !== undefined && o.expires_at !== null)
  // Stricter than `Date.parse`, which accepted `Jan 1 2026` while the message claimed ISO.
  @IsISO8601({}, { message: 'expires_at must be an ISO timestamp or null' })
  expires_at?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1 })
  @ValidateIf((o) => o.max_uses !== undefined && o.max_uses !== null)
  @IsInt({ message: 'max_uses must be a positive integer or null' })
  @Min(1, { message: 'max_uses must be a positive integer or null' })
  max_uses?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  voided?: boolean;

  @ReasonProperty()
  reason?: string;
}

/**
 * Manual budget adjustment (goodwill credit, or clawback). Negatives allowed, but the service still
 * refuses to take a budget below zero.
 */
export class AdjustBudgetDto {
  @ApiProperty({ minimum: -10_000_000, maximum: 10_000_000 })
  @IsInt({ message: 'coins must be a non-zero integer within ±10000000' })
  @NotEquals(0, { message: 'coins must be a non-zero integer within ±10000000' })
  @Min(-10_000_000, { message: 'coins must be a non-zero integer within ±10000000' })
  @Max(10_000_000, { message: 'coins must be a non-zero integer within ±10000000' })
  coins!: number;

  @ReasonProperty()
  reason?: string;

  /**
   * Hand-driven money-in, so a double-submitted form is the likeliest double pay; with a key the
   * retry collides on `UNIQUE (account, ref)` instead.
   */
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MaxLength(64)
  // `''` is "no key": otherwise every blank submission shares the ref `admin-adjust:{id}:` and the
  // second is swallowed as an already-applied retry.
  @Transform(({ value }) => (value === '' ? undefined : value))
  idempotency_key?: string;
}

export class AckNotificationsDto {
  /** omit to acknowledge the whole inbox */
  @ApiPropertyOptional({ type: [String], maxItems: 1000 })
  @IsOptional()
  @IsArray({ message: 'ids must be an array of strings' })
  @IsString({ each: true, message: 'ids must be an array of strings' })
  // Capped at the inbox's own read ceiling so `id IN (...)` stays bounded; omit `ids` for more.
  @ArrayMaxSize(1000)
  ids?: string[];
}

export class WithdrawalDecisionDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MaxLength(300)
  @Transform(({ value }) => (value === '' ? undefined : value))
  note?: string;
}

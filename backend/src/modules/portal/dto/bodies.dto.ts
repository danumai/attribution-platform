import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotContains,
  ValidateIf,
} from 'class-validator';
import { MAX_BONUSES } from '../../../common/attribution';
import { AppTargetsDto, blank } from '../../../common/dto/app-targets.dto';
import { QrStyle } from '../../../common/qr';

/**
 * One of the four negotiated rates, with no range decorator on purpose: `validateRates` checks
 * `guest_rate <= coin_rate` post-patch, which needs the stored row. The schema range is docs only.
 */
function RateProperty(min: number, max: number) {
  return (target: object, key: string) => {
    ApiPropertyOptional({ minimum: min, maximum: max })(target, key);
    IsOptional()(target, key);
    IsInt()(target, key);
  };
}

/**
 * The promoter's pick out of the publisher's offers; shape only — which slugs are allowed depends on
 * the live list and mode, so `validateBonusTypes` owns that. `''`/null mean "no pick": all eligible.
 */
function BonusTypesProperty() {
  return (target: object, key: string) => {
    ApiPropertyOptional({ type: [String], maxItems: MAX_BONUSES, example: ['coins'] })(target, key);
    IsOptional()(target, key);
    IsArray()(target, key);
    ArrayMaxSize(MAX_BONUSES)(target, key);
    IsString({ each: true })(target, key);
    MaxLength(40, { each: true })(target, key);
    NotContains('\0', { each: true, message: '$property must not contain null bytes' })(target, key);
    Transform(({ value }) => (value === '' || value === null ? [] : value))(target, key);
  };
}

/** A coin amount moving into or out of the platform, in the one range every money route shares. */
function CoinsProperty() {
  return (target: object, key: string) => {
    ApiProperty({ minimum: 1, maximum: 10_000_000 })(target, key);
    IsInt({ message: 'coins must be 1–10000000' })(target, key);
    Min(1, { message: 'coins must be 1–10000000' })(target, key);
    Max(10_000_000, { message: 'coins must be 1–10000000' })(target, key);
  };
}

export class RequestPartnershipDto {
  @ApiProperty({ format: 'uuid' })
  // Rejected here, not by the driver: a malformed uuid surfaced as a 22P02 that
  // PrismaExceptionFilter had to translate back into the 400 it always was.
  @IsUUID()
  publisher_org_id!: string;

  @RateProperty(1, 100_000)
  coin_rate?: number;

  @RateProperty(0, 100_000)
  guest_rate?: number;

  @RateProperty(0, 365)
  grace_days?: number;

  /** priced separately from the acquisition pair — see `validateRates` */
  @RateProperty(0, 100_000)
  engagement_rate?: number;
}

/** A proposal, not a change; `grace_days` is absent because a promoter may not reprice it mid-deal. */
export class ProposeRatesDto {
  @RateProperty(1, 100_000)
  coin_rate?: number;

  @RateProperty(0, 100_000)
  guest_rate?: number;

  @RateProperty(0, 100_000)
  engagement_rate?: number;
}

export class CreateCampaignDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  partnership_id!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  // Postgres cannot store NUL in text: it rejects mid-transaction, surfacing as a 500, not a 400.
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /**
   * Fixed at creation, hence no `mode` on the patch: it selects which payout guarantee redemptions
   * live under, and those are partial unique indexes over existing rows. Run both as two campaigns.
   */
  @ApiPropertyOptional({ enum: ['acquisition', 'engagement'], default: 'acquisition' })
  @IsOptional()
  @IsIn(['acquisition', 'engagement'], { message: 'mode must be acquisition|engagement' })
  mode?: string;

  @BonusTypesProperty()
  bonus_types?: string[];
}

/** Absent = leave unchanged, so a rename cannot restate the status and reactivate an ended campaign. */
export class PatchCampaignDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: ['active', 'paused', 'ended'] })
  @IsOptional()
  @IsIn(['active', 'paused', 'ended'], { message: 'status must be active|paused|ended' })
  status?: string;

  /** Repickable, unlike `mode`: nothing was paid at these slugs. The poster is what cannot be redone. */
  @BonusTypesProperty()
  bonus_types?: string[];
}

export class FundCampaignDto {
  @CoinsProperty()
  coins!: number;

  /**
   * Hand-driven money-in, so a double-submitted form is the likeliest double pay; with a key the
   * retry collides on `UNIQUE (account, ref)` instead.
   */
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MaxLength(64)
  // `''` is "no key": otherwise every blank submission shares the ref `fund:{id}:` and the second
  // is swallowed as an already-applied retry.
  @Transform(({ value }) => (value === '' ? undefined : value))
  idempotency_key?: string;
}

/**
 * The printed design. No nested DTO for `style`: `validateStyle` is the one definition of what
 * renders, including rules no decorator can state (contrast floor, `ecc: 'H'` under a logo).
 */
export class CreateQrCodeDto {
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  style?: QrStyle;

  /** time-bound by default; 0 means "no expiry" and needs an admin override */
  @ApiPropertyOptional({ minimum: 0, maximum: 3650, default: 30 })
  @IsOptional()
  @IsInt({ message: 'expires_in_days must be an integer 0–3650' })
  @Min(0, { message: 'expires_in_days must be an integer 0–3650' })
  @Max(3650, { message: 'expires_in_days must be an integer 0–3650' })
  expires_in_days?: number;

  /** `null` is unlimited — a value, not an omission, hence `@ValidateIf`; `@IsOptional()` skips null. */
  @ApiPropertyOptional({ nullable: true, minimum: 1 })
  @ValidateIf((o) => o.max_uses !== undefined && o.max_uses !== null)
  @IsInt({ message: 'max_uses must be a positive integer, or null for unlimited' })
  @Min(1, { message: 'max_uses must be a positive integer, or null for unlimited' })
  max_uses?: number | null;
}

export class RestyleQrCodeDto {
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  style?: QrStyle;
}

/**
 * Where scans go. Absent = unchanged; `""`/`null`/`[]` clears, so blanks normalise to null instead of
 * failing a format check. `slug` + `ios_appclip_id` pair in the service: one alone is a dead prefix.
 */
export class PatchOrgDto extends AppTargetsDto {
  /** `TEAMID.bundle.id.Clip` — set it and this publisher's QR codes become App Clip URLs */
  @ApiPropertyOptional({ example: 'ABCDE12345.com.example.app.Clip' })
  @IsOptional()
  // Strict because one malformed entry invalidates the whole AASA document, silently breaking App
  // Clip invocation for every publisher in it.
  @Matches(/^[A-Z0-9]{10}\.[A-Za-z0-9.-]{1,180}$/, {
    message: 'ios_appclip_id must be TEAMID.bundle.id.Clip, e.g. ABCDE12345.com.example.app.Clip',
  })
  @Transform(({ value }) => (blank(value) ? null : typeof value === 'string' ? value.trim() : value))
  ios_appclip_id?: string | null;

  /**
   * Path segment of that App Clip URL and the prefix registered in App Store Connect. DNS-label
   * shape, since it becomes a subdomain if Apple ever refuses two apps sharing one domain.
   */
  @ApiPropertyOptional({ example: 'dramabox' })
  @IsOptional()
  @Matches(/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/, {
    message: 'slug must be 3–40 characters of a–z, 0–9 and hyphens',
  })
  @Transform(({ value }) =>
    blank(value) ? null : typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  slug?: string | null;

  /** App Store Connect provider token, for the aggregate campaign-link cross-check */
  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @Matches(/^\d{4,20}$/, {
    message: 'ios_provider_token must be the numeric provider id from App Store Connect',
  })
  // Accepts a number as well as a string.
  @Transform(({ value }) =>
    blank(value)
      ? null
      : typeof value === 'string' || typeof value === 'number'
        ? String(value).trim()
        : value,
  )
  ios_provider_token?: string | null;
}

export class RequestWithdrawalDto {
  @CoinsProperty()
  coins!: number;
}

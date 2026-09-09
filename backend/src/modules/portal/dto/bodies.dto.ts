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
 * One of the four negotiated rates. Deliberately carrying no range decorator: `validateRates`
 * resolves a patch against the row already stored and enforces `guest_rate <= coin_rate` on the
 * *post-patch* pair, which needs the current values and so cannot happen in a DTO. Duplicating
 * the bounds here would make a money rule with two definitions, which is a money rule with two
 * answers — the range on the schema is documentation, not a second check.
 */
function RateProperty(min: number, max: number) {
  return (target: object, key: string) => {
    ApiPropertyOptional({ minimum: min, maximum: max })(target, key);
    IsOptional()(target, key);
    IsInt()(target, key);
  };
}

/**
 * The promoter's pick out of the publisher's offers. Only the shape is checked here: which slugs
 * are *allowed* depends on the publisher's live list and the campaign's mode, so `validateBonusTypes`
 * owns that — and the trimming, lowercasing and de-duplication with it. `''` and null mean "no
 * pick", which is how a campaign goes back to advertising everything it is eligible for.
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
  // Rejected here rather than reaching the driver: a malformed uuid used to surface as a 22P02
  // that PrismaExceptionFilter had to translate back into the 400 it always was.
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

/**
 * A proposal, not a change: `grace_days` is absent on purpose — it is not part of what a promoter
 * may ask to reprice mid-deal.
 */
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
  // Rejecting loudly beats truncating silently, and Postgres cannot store NUL in a text column —
  // it rejects mid-transaction, which surfaces as a 500 rather than the 400 it is.
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /**
   * Fixed at creation: it selects which payout guarantee the redemptions live under, and those
   * are partial unique indexes over rows that already exist. Two campaigns is the honest way to
   * run both, and they can share a partnership — which is why there is no `mode` on the patch.
   */
  @ApiPropertyOptional({ enum: ['acquisition', 'engagement'], default: 'acquisition' })
  @IsOptional()
  @IsIn(['acquisition', 'engagement'], { message: 'mode must be acquisition|engagement' })
  mode?: string;

  @BonusTypesProperty()
  bonus_types?: string[];
}

/**
 * Absent = leave unchanged, as in `PATCH orgs/me`, so a rename need not restate the status and
 * quietly reactivate an ended campaign.
 */
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

  /**
   * The reward is repickable, unlike `mode`: nothing was paid at these slugs. What cannot be
   * redone is the poster, so this is deliberate rather than something that drifts.
   */
  @BonusTypesProperty()
  bonus_types?: string[];
}

export class FundCampaignDto {
  @CoinsProperty()
  coins!: number;

  /**
   * A hand-driven money-in path, so a double-submitted form is the likeliest way this ever pays
   * twice. With a key the retry collides on `UNIQUE (account, ref)` instead.
   */
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MaxLength(64)
  // `''` is "no key", not a key — otherwise every blank submission shares the ref
  // `fund:{id}:` and the second one is swallowed as an already-applied retry.
  @Transform(({ value }) => (value === '' ? undefined : value))
  idempotency_key?: string;
}

/**
 * The printed design. `style` carries no nested DTO on purpose: `validateStyle` is the one
 * definition of what renders, and it also decides the rules no decorator can state — the
 * contrast floor that keeps a code scannable, and forcing `ecc: 'H'` when a logo covers modules.
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

  /**
   * `null` is unlimited, and it is a *value* here rather than an omission — hence `@ValidateIf`
   * rather than `@IsOptional()`, which skips null too.
   */
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
 * Where scans go, and what the publisher says it gives new users. Absent = leave unchanged; an
 * explicit `""`, `null` or `[]` clears the field, which is why every property here normalises to
 * null rather than failing its format check on a blank.
 *
 * `slug` and `ios_appclip_id` are checked as a pair by the service: one without the other
 * registers a prefix nothing answers to, and that rule needs the org as it will be *after* the
 * patch, so it cannot live in a pipe.
 */
export class PatchOrgDto extends AppTargetsDto {
  /** `TEAMID.bundle.id.Clip` — set it and this publisher's QR codes become App Clip URLs */
  @ApiPropertyOptional({ example: 'ABCDE12345.com.example.app.Clip' })
  @IsOptional()
  // Validated hard because one malformed entry invalidates the whole AASA document and silently
  // breaks App Clip invocation for every publisher in it.
  @Matches(/^[A-Z0-9]{10}\.[A-Za-z0-9.-]{1,180}$/, {
    message: 'ios_appclip_id must be TEAMID.bundle.id.Clip, e.g. ABCDE12345.com.example.app.Clip',
  })
  @Transform(({ value }) => (blank(value) ? null : typeof value === 'string' ? value.trim() : value))
  ios_appclip_id?: string | null;

  /**
   * The path segment of that App Clip URL, and the prefix registered in App Store Connect.
   * DNS-label shape, because the same string becomes a subdomain if Apple ever refuses two apps
   * sharing one domain.
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
  // Accepts a number as well as a string, as the imperative validator did.
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

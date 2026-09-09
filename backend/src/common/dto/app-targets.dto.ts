import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, Matches, MaxLength } from 'class-validator';
import { BonusDto, BonusListProperty } from './bonus.dto';
import { IsRedirectUrl } from '../validation';

/**
 * Absent, null and `''` all mean "not set", and `''` specifically is how a PATCH *clears* a
 * column — so it must normalise to null rather than fail the format check on the field. Every
 * field here therefore pairs its transform with `@IsOptional()`, which skips validation for null.
 *
 * One `@Transform` per property, doing both the blank check and the normalisation: class-transformer
 * runs multiple transforms on a property in decorator *application* order, which is bottom-to-top,
 * and a rule that subtle is one reorder away from silently not running.
 */
export const blank = (v: unknown) => v === undefined || v === null || v === '';

/**
 * Where a scan is sent, as a tenant declares it. Shared because signup, `PATCH /v1/orgs/me` and
 * `PATCH /v1/admin/orgs/:id` all accept exactly these — three copies is three chances for one to
 * drift into accepting something the others reject.
 */
export class AppTargetsDto {
  /** the page a desktop scan, or a publisher with no app registered, is sent to */
  @ApiPropertyOptional({ example: 'https://example.com/promo' })
  @IsOptional()
  @IsRedirectUrl()
  landing_url?: string | null;

  /** engagement only; an https origin the publisher has claimed as an App Link / Universal Link */
  @ApiPropertyOptional({ example: 'https://example.com/open' })
  @IsOptional()
  @IsRedirectUrl()
  deeplink_url?: string | null;

  /** Reverse-DNS, as Play requires. Anchored so it cannot smuggle a query string into the URL. */
  @ApiPropertyOptional({ example: 'com.example.app' })
  @IsOptional()
  @MaxLength(255, { message: 'android_package must look like com.example.app' })
  @Matches(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i, {
    message: 'android_package must look like com.example.app',
  })
  @Transform(({ value }) => (blank(value) ? null : typeof value === 'string' ? value.trim() : value))
  android_package?: string | null;

  /** Apple's numeric adam id — the digits in apps.apple.com/app/id123456789. */
  @ApiPropertyOptional({ example: '123456789' })
  @IsOptional()
  @Matches(/^\d{6,12}$/, {
    message: 'ios_app_id must be the numeric App Store id, e.g. 123456789',
  })
  // Accepts a number as well as a string, and tolerates the `id` prefix people copy out of a
  // store URL, exactly as the imperative validator did.
  @Transform(({ value }) =>
    blank(value)
      ? null
      : typeof value === 'string' || typeof value === 'number'
        ? String(value).trim().replace(/^id/i, '')
        : value,
  )
  ios_app_id?: string | null;

  /** the offers this publisher grants out of its own pocket */
  @BonusListProperty()
  bonuses?: BonusDto[];
}

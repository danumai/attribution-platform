import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, Matches, MaxLength } from 'class-validator';
import { BonusDto, BonusListProperty } from './bonus.dto';
import { IsRedirectUrl } from '../validation';

/**
 * Absent, null and `''` mean "not set"; `''` clears a column on PATCH, so it normalises to null and
 * `@IsOptional()` skips it rather than failing the format check. One `@Transform` each, bottom-to-top.
 */
export const blank = (v: unknown) => v === undefined || v === null || v === '';

/**
 * Where a scan is sent, as a tenant declares it. Shared so signup, `PATCH /v1/orgs/me` and
 * `PATCH /v1/admin/orgs/:id` cannot drift into accepting different things.
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
  // Accepts a number as well as a string, and strips the `id` prefix copied out of a store URL.
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

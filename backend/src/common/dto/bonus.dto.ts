import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, plainToInstance } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Max,
  MinLength,
  NotContains,
  ValidateNested,
} from 'class-validator';
import { Bonus, BonusOn, MAX_BONUSES } from '../attribution';
import { HasUniqueBonusTypes } from '../validation';

const BONUS_ON: BonusOn[] = ['acquisition', 'engagement', 'both'];

const trimLower = Transform(({ value }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value,
);
const trim = Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/**
 * What the publisher gives a user out of its *own* pocket. `type` is free text with no registry:
 * the platform never issues or fulfils any of these, so an unrecognised type costs it nothing,
 * where anything narrower would be a deploy per invented offer.
 */
export class BonusDto {
  /** the publisher's own slug for the kind of thing granted: `coins`, `subscription`, … */
  @ApiProperty({ example: 'coins' })
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MaxLength(40)
  // Slug rather than free text: `type` is the key the publisher's app switches on, and a key with
  // spaces or punctuation is one nobody can match on reliably.
  @Matches(/^[a-z0-9][a-z0-9_-]*$/, {
    message: '$property must be a slug, e.g. coins or subscription',
  })
  @trimLower
  type!: string;

  /** human wording, for artwork and reports */
  @ApiProperty({ example: '100 bonus coins' })
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MinLength(1)
  @MaxLength(120)
  @trim
  label!: string;

  /** which claim this is granted on; `both` is the default */
  @ApiPropertyOptional({ enum: BONUS_ON, default: 'both' })
  @IsOptional()
  @IsIn(BONUS_ON)
  @Transform(({ value }) => value ?? 'both')
  on: BonusOn = 'both';

  /** optional amount, for the offers that have one: 100 coins, 7 days */
  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  // Coerced rather than required to arrive as a number: `"100"` from a form post was accepted
  // before and still is. `''` is "not set", not zero.
  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  value?: number;

  /** optional unit for `value`: `coins`, `days`, `percent` */
  @ApiPropertyOptional({ example: 'coins' })
  @IsOptional()
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MaxLength(20)
  @trim
  unit?: string;
}

/**
 * DTO instance to the shape that goes into the JSONB column.
 *
 * Not a cast: `Bonus` is a type *alias* precisely because only an alias gets the implicit index
 * signature Prisma's `InputJsonValue` requires, and a class instance has no such signature. The
 * empty-value keys are dropped rather than written as `undefined`, which JSON.stringify would
 * turn into a missing key anyway — this way the row and the response agree.
 */
export function toBonus(dto: BonusDto): Bonus {
  return {
    type: dto.type,
    label: dto.label,
    on: dto.on ?? 'both',
    ...(dto.value === undefined ? {} : { value: dto.value }),
    ...(dto.unit ? { unit: dto.unit } : {}),
  };
}

export const toBonuses = (list?: BonusDto[]): Bonus[] => (list ?? []).map(toBonus);

/** The `bonuses` property as every DTO that accepts one declares it. */
export function BonusListProperty() {
  return (target: object, key: string) => {
    ApiPropertyOptional({ type: [BonusDto], maxItems: MAX_BONUSES })(target, key);
    IsOptional()(target, key);
    IsArray()(target, key);
    // Matches the CHECK in 9d_publisher_bonuses; one PATCH must not bloat every claim response.
    ArrayMaxSize(MAX_BONUSES)(target, key);
    ValidateNested({ each: true })(target, key);
    HasUniqueBonusTypes()(target, key);
    // Builds the element instances by hand instead of `@Type(() => BonusDto)`, because a
    // `@Transform` on the same property takes precedence over `@Type` — with both, the elements
    // stay plain objects and `@ValidateNested` has nothing to descend into. The transform is
    // needed at all because `''` and null mean "no offers", the same as an absent key, and that
    // is how a publisher clears its list.
    Transform(({ value }) => {
      // Absent stays absent, and that distinction is load-bearing: a PATCH that does not mention
      // `bonuses` must leave the column alone, where one sending `''` or null is clearing it.
      // Collapsing both to `[]` here would silently wipe a publisher's offers on every unrelated
      // PATCH. `toBonuses()` maps undefined to `[]` for the create path, which does want that.
      if (value === undefined) return undefined;
      if (value === '' || value === null) return [];
      if (!Array.isArray(value)) return value; // shape is @IsArray's to reject
      return value.map((entry) => plainToInstance(BonusDto, entry));
    })(target, key);
  };
}

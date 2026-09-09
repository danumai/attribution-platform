import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength, MinLength, NotContains } from 'class-validator';
import { AppTargetsDto } from '../../../common/dto/app-targets.dto';
import { MaxByteLength } from '../../../common/validation';

/** The two roles a stranger may create. `admin` is seeded, never signed up for. */
const SIGNUP_TYPES = ['promoter', 'publisher'] as const;

/**
 * bcrypt silently ignores everything past 72 bytes, so without a ceiling a 200-character
 * passphrase is only ever its first 72 bytes — and any other string sharing that prefix would log
 * in. Rejecting is honest; truncating is a trap.
 */
export const MAX_PASSWORD_BYTES = 72;

export class SignupDto extends AppTargetsDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  // Rejecting loudly beats truncating silently, and Postgres cannot store NUL in a text column —
  // it rejects mid-transaction, which surfaces as a 500 rather than the 400 it is.
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ maxLength: 254, example: 'ops@example.com' })
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MaxLength(254)
  // Shape check only — the address is proven by nothing here, so it stays a display field. The
  // permissive pattern is deliberate and predates `@IsEmail()`: tightening it now would start
  // rejecting addresses already registered.
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'email must be a valid address' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 200 })
  // Through `@IsString` like every other field: a non-string password reached `.length` as
  // `undefined` (so the minimum silently passed) and then threw inside `byteLength` as a 500.
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MinLength(8, { message: 'password min 8 chars' })
  @MaxLength(200)
  @MaxByteLength(MAX_PASSWORD_BYTES)
  password!: string;

  @ApiProperty({ enum: SIGNUP_TYPES })
  @IsIn(SIGNUP_TYPES, { message: 'type must be one of promoter, publisher' })
  type!: (typeof SIGNUP_TYPES)[number];
}

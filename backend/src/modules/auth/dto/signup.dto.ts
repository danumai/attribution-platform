import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength, MinLength, NotContains } from 'class-validator';
import { AppTargetsDto } from '../../../common/dto/app-targets.dto';
import { MaxByteLength } from '../../../common/validation';

/** The two roles a stranger may create. `admin` is seeded, never signed up for. */
const SIGNUP_TYPES = ['promoter', 'publisher'] as const;

/**
 * bcrypt ignores everything past 72 bytes, so without this ceiling any string sharing a long
 * passphrase's first 72 bytes would log in. Rejecting is honest; truncating is a trap.
 */
export const MAX_PASSWORD_BYTES = 72;

export class SignupDto extends AppTargetsDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  // Postgres cannot store NUL in text: it rejects mid-transaction, surfacing as a 500, not a 400.
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ maxLength: 254, example: 'ops@example.com' })
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MaxLength(254)
  // Shape only, and deliberately looser than `@IsEmail()`: tightening would reject addresses
  // already registered. Nothing proves the address, so it stays a display field.
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'email must be a valid address' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 200 })
  // `@IsString` first: a non-string password passed the minimum silently, then 500'd in `byteLength`.
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

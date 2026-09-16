import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength, NotContains } from 'class-validator';
import { MAX_PASSWORD_BYTES } from './signup.dto';
import { MaxByteLength } from '../../../common/validation';

export class ResetDto {
  /** issued out of band by `POST /v1/admin/orgs/:id/reset-token`; this endpoint is mailer-free */
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MinLength(1)
  @MaxLength(128)
  token!: string;

  @ApiProperty({ minLength: 8, maxLength: 200 })
  @IsString()
  @NotContains('\0', { message: '$property must not contain null bytes' })
  @MinLength(8, { message: 'password min 8 chars' })
  @MaxLength(200)
  @MaxByteLength(MAX_PASSWORD_BYTES)
  password!: string;
}

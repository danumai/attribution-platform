import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

/**
 * Validates nothing on purpose: a 400 would tell a prober what a 401 does not, so the service coerces
 * and every failure leaves by one door. `@Allow()` stops `whitelist: true` stripping both credentials.
 */
export class LoginDto {
  @ApiProperty()
  @Allow()
  email?: unknown;

  @ApiProperty()
  @Allow()
  password?: unknown;
}

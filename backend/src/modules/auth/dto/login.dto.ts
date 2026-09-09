import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

/**
 * The one DTO on the platform that validates nothing, on purpose.
 *
 * A non-string credential simply cannot match, and a 400 here would tell a prober something a 401
 * does not — that the field reached the handler in a usable shape. So the values are coerced in
 * the service instead, and every failure leaves by the same door.
 *
 * `@Allow()` rather than a bare property: `whitelist: true` strips any property carrying no
 * decorator at all, which would delete both credentials before the service ever saw them.
 */
export class LoginDto {
  @ApiProperty()
  @Allow()
  email?: unknown;

  @ApiProperty()
  @Allow()
  password?: unknown;
}

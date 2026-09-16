/**
 * Partner API: server-to-server only, answering just "is this new user attributable to a campaign?"
 * No path here grants currency or anything a device could redeem — that is the compliance argument.
 */
import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClaimBody, FirstOpenBody } from './dto/bodies.dto';
import { PartnerService } from './partner.service';

@ApiTags('Partner API')
@ApiBearerAuth('apiKey')
@Controller('v1/attribution')
export class PartnerController {
  constructor(private readonly svc: PartnerService) {}

  /**
   * Stage one: first app open, nothing paid. The claim id is readable only at launch but signup is
   * usually later, so this consumes the scan for an `install_id` the SDK persists; replays `no_match`.
   */
  @Post('first-open')
  @HttpCode(200)
  firstOpen(@Headers('authorization') auth: string, @Body() b: FirstOpenBody) {
    return this.svc.firstOpen(auth, b);
  }

  /**
   * Stage two: signup done, fee earned. Prefer `{ install_id, publisher_user_ref }`; the carrier
   * fields are the legacy single-call shape, whose cost is an abandoned signup leaving the scan
   * claimable. A `code` routes to the engagement payout; unattributed is normal, so a 200 not an error.
   */
  @Post('claim')
  @HttpCode(200)
  claim(@Headers('authorization') auth: string, @Body() b: ClaimBody) {
    return this.svc.claim(auth, b);
  }

  /**
   * Second leg: the user cleared the publisher's verification bar inside the grace period,
   * so the held-back part of the fee is released. Idempotent — a second call is a no-op.
   */
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@Headers('authorization') auth: string, @Param('id') id: string) {
    return this.svc.confirm(auth, id);
  }

  @Get(':id')
  get(@Headers('authorization') auth: string, @Param('id') id: string) {
    return this.svc.get(auth, id);
  }
}

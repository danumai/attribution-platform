/**
 * Partner API: server-to-server only. It answers exactly one question — "is this new user
 * attributable to a campaign?" — and no code path here can grant currency or hand back
 * anything a device could redeem. That separation is the compliance argument.
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
   * Stage one: first app open. Nothing is paid here. The claim id is readable only at launch — an
   * App Clip's container is migrated once, the pasteboard holds one thing — but signup is
   * routinely the next day, so this consumes the scan and returns an `install_id` the SDK must
   * persist. A second call finds the scan consumed and answers `no_match`.
   */
  @Post('first-open')
  @HttpCode(200)
  firstOpen(@Headers('authorization') auth: string, @Body() b: FirstOpenBody) {
    return this.svc.firstOpen(auth, b);
  }

  /**
   * Stage two: a new user finished signing up, so the fee is earned. Preferred shape is
   * `{ install_id, publisher_user_ref }`; the carrier fields are the legacy single-call shape,
   * whose only cost is that a signup that never happens leaves the scan claimable.
   *
   * A `code` instead routes to the engagement payout — a repeat purchase, priced separately.
   *
   * Unattributed is a normal answer — most installs are organic — so a 200, not an error.
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

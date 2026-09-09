import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LimitQuery } from '../../common/dto/paging.dto';
import { AdminGuard, Session } from '../auth/auth.guard';
import { SessionClaims } from '../auth/tokens';
import { AdminService } from './admin.service';
import {
  AckNotificationsDto,
  AdjustBudgetDto,
  PatchCampaignDto,
  PatchOrgDto,
  PatchPartnershipDto,
  PatchQrCodeDto,
  ReasonDto,
  WithdrawalDecisionDto,
} from './dto/bodies.dto';
import {
  AnalyticsQuery,
  LedgerQuery,
  OrgsQuery,
  ScansQuery,
  WithdrawalsQuery,
} from './dto/queries.dto';

/**
 * Super admin: reads everything across all orgs and can act on anything. No org scoping here —
 * `AdminGuard` is the whole boundary, and it is declared once for every route on the class.
 *
 * Routing only. Path ids are parsed by `ParseUUIDPipe` so a malformed one is rejected here rather
 * than reaching the driver as a 22P02 for `PrismaExceptionFilter` to translate back into a 400.
 */
@ApiTags('Admin')
@ApiBearerAuth('session')
@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('orgs')
  orgs(@Query() query: OrgsQuery) {
    return this.admin.orgs(query);
  }

  @Patch('orgs/:id')
  patchOrg(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PatchOrgDto,
  ) {
    return this.admin.patchOrg(s.org_id, id, body);
  }

  @Post('orgs/:id/rotate-key')
  rotateKey(@Session() s: SessionClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.rotateKey(s.org_id, id);
  }

  @Post('orgs/:id/reset-token')
  resetToken(@Session() s: SessionClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.resetToken(s.org_id, id);
  }

  @Post('orgs/:id/offboard')
  offboard(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ) {
    return this.admin.offboard(s.org_id, id, body.reason);
  }

  @Delete('orgs/:id')
  deleteOrg(@Session() s: SessionClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.deleteOrg(s.org_id, id);
  }

  @Get('partnerships')
  partnerships(@Query() query: LimitQuery) {
    return this.admin.partnerships(query);
  }

  @Patch('partnerships/:id')
  patchPartnership(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PatchPartnershipDto,
  ) {
    return this.admin.patchPartnership(s.org_id, id, body);
  }

  @Get('campaigns')
  campaigns(@Query() query: LimitQuery) {
    return this.admin.campaigns(query);
  }

  @Patch('campaigns/:id')
  patchCampaign(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PatchCampaignDto,
  ) {
    return this.admin.patchCampaign(s.org_id, id, body);
  }

  @Post('campaigns/:id/kill')
  kill(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ) {
    return this.admin.kill(s.org_id, id, body.reason);
  }

  @Post('campaigns/:id/adjust')
  adjust(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdjustBudgetDto,
  ) {
    return this.admin.adjust(s.org_id, id, body);
  }

  @Get('qr-codes')
  qrCodes(@Query() query: LimitQuery) {
    return this.admin.qrCodes(query);
  }

  @Patch('qr-codes/:id')
  patchQr(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PatchQrCodeDto,
  ) {
    return this.admin.patchQr(s.org_id, id, body);
  }

  @Get('notifications')
  notifications(@Query() query: LimitQuery) {
    return this.admin.notifications(query);
  }

  @Post('notifications/ack')
  ackNotifications(@Body() body: AckNotificationsDto) {
    return this.admin.ackNotifications(body);
  }

  @Get('audit-log')
  auditLog(@Query() query: LimitQuery) {
    return this.admin.auditLog(query);
  }

  @Get('analytics')
  analytics(@Query() query: AnalyticsQuery) {
    return this.admin.analytics(query);
  }

  @Get('scans')
  scans(@Query() query: ScansQuery) {
    return this.admin.scans(query);
  }

  @Get('redemptions')
  redemptions(@Query() query: LimitQuery) {
    return this.admin.redemptions(query);
  }

  @Get('withdrawals')
  withdrawals(@Query() query: WithdrawalsQuery) {
    return this.admin.withdrawals(query);
  }

  @Post('withdrawals/:id/pay')
  payWithdrawal(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WithdrawalDecisionDto,
  ) {
    return this.admin.payWithdrawal(s.org_id, id, body);
  }

  @Post('withdrawals/:id/reject')
  rejectWithdrawal(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WithdrawalDecisionDto,
  ) {
    return this.admin.rejectWithdrawal(s.org_id, id, body);
  }

  @Get('ledger')
  ledgerEntries(@Query() query: LedgerQuery) {
    return this.admin.ledgerEntries(query);
  }
}

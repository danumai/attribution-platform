import {
  Body,
  Controller,
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
import { AuthGuard, Session } from '../auth/auth.guard';
import { SessionClaims } from '../auth/tokens';
import {
  CreateCampaignDto,
  CreateQrCodeDto,
  FundCampaignDto,
  PatchCampaignDto,
  PatchOrgDto,
  ProposeRatesDto,
  RequestPartnershipDto,
  RequestWithdrawalDto,
  RestyleQrCodeDto,
} from './dto/bodies.dto';
import { CampaignAnalyticsQuery, RedemptionsQuery } from './dto/queries.dto';
import { PortalService } from './portal.service';

/**
 * Tenant console for both roles. `AuthGuard` only proves a live tenant; role checks are the
 * service's job. `ParseUUIDPipe` rejects malformed ids here instead of as a driver 22P02.
 */
@ApiTags('Portal')
@ApiBearerAuth('session')
@Controller('v1')
@UseGuards(AuthGuard)
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('publishers')
  publishers() {
    return this.portal.publishers();
  }

  @Post('partnerships')
  requestPartnership(@Session() s: SessionClaims, @Body() body: RequestPartnershipDto) {
    return this.portal.requestPartnership(s, body);
  }

  @Get('partnerships')
  listPartnerships(@Session() s: SessionClaims, @Query() query: LimitQuery) {
    return this.portal.listPartnerships(s, query.limit);
  }

  @Post('partnerships/:id/accept')
  accept(@Session() s: SessionClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.accept(s, id);
  }

  @Patch('partnerships/:id/rates')
  proposeRates(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ProposeRatesDto,
  ) {
    return this.portal.proposeRates(s, id, body);
  }

  @Post('partnerships/:id/rates/accept')
  acceptRates(@Session() s: SessionClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.decideRates(s, id, true);
  }

  @Post('partnerships/:id/rates/decline')
  declineRates(@Session() s: SessionClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.decideRates(s, id, false);
  }

  @Post('campaigns')
  createCampaign(@Session() s: SessionClaims, @Body() body: CreateCampaignDto) {
    return this.portal.createCampaign(s, body);
  }

  @Get('campaigns')
  listCampaigns(@Session() s: SessionClaims, @Query() query: LimitQuery) {
    return this.portal.listCampaigns(s, query.limit);
  }

  @Post('campaigns/:id/fund')
  fund(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: FundCampaignDto,
  ) {
    return this.portal.fund(s, id, body);
  }

  @Patch('campaigns/:id')
  patchCampaign(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PatchCampaignDto,
  ) {
    return this.portal.patchCampaign(s, id, body);
  }

  @Get('campaigns/:id/stats')
  stats(@Session() s: SessionClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.stats(s, id);
  }

  @Get('campaigns/:id/analytics')
  analytics(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CampaignAnalyticsQuery,
  ) {
    return this.portal.analytics(s, id, query.days);
  }

  @Post('campaigns/:id/qr-codes')
  createQr(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateQrCodeDto,
  ) {
    return this.portal.createQr(s, id, body);
  }

  @Get('campaigns/:id/qr-codes')
  listQr(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: LimitQuery,
  ) {
    return this.portal.listQr(s, id, query.limit);
  }

  @Post('qr-codes/:id/void')
  voidQr(@Session() s: SessionClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.voidQr(s, id);
  }

  @Patch('qr-codes/:id')
  restyleQr(
    @Session() s: SessionClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RestyleQrCodeDto,
  ) {
    return this.portal.restyleQr(s, id, body);
  }

  @Post('api-keys/rotate')
  rotateKey(@Session() s: SessionClaims) {
    return this.portal.rotateKey(s);
  }

  @Get('orgs/me')
  me(@Session() s: SessionClaims) {
    return this.portal.me(s);
  }

  @Patch('orgs/me')
  patchOrg(@Session() s: SessionClaims, @Body() body: PatchOrgDto) {
    return this.portal.patchOrg(s, body);
  }

  @Post('withdrawals')
  requestWithdrawal(@Session() s: SessionClaims, @Body() body: RequestWithdrawalDto) {
    return this.portal.requestWithdrawal(s, body);
  }

  @Get('withdrawals')
  listWithdrawals(@Session() s: SessionClaims, @Query() query: LimitQuery) {
    return this.portal.listWithdrawals(s, query.limit);
  }

  @Get('redemptions')
  redemptions(@Session() s: SessionClaims, @Query() query: RedemptionsQuery) {
    return this.portal.redemptions(s, query.limit);
  }
}

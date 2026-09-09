/**
 * Money in — the production replacement for ALLOW_SELF_FUNDING. PSP-agnostic: `checkout` hands
 * back a `payment_id` the PSP carries in metadata and signs back to `webhook`, so swapping
 * processors is an adapter, not a schema change. Raw body is read here so the service signs a
 * `Buffer` and knows nothing about express.
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthGuard, Session } from '../auth/auth.guard';
import { SessionClaims } from '../auth/tokens';
import { CheckoutBody, WebhookBody } from './dto/bodies.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('v1/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('checkout')
  @ApiBearerAuth('session')
  @UseGuards(AuthGuard)
  checkout(@Session() s: SessionClaims, @Body() b: CheckoutBody) {
    return this.payments.checkout(s.org_id, b);
  }

  @Get()
  @ApiBearerAuth('session')
  @UseGuards(AuthGuard)
  list(@Session() s: SessionClaims, @Query('limit') limit?: string) {
    return this.payments.list(s.org_id, limit);
  }

  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: Request,
    @Headers('x-payment-signature') signature: string,
    @Body() b: WebhookBody,
  ) {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    return this.payments.webhook(raw, signature, b);
  }
}

/**
 * Issuance API: server-to-server, called by the promoter's backend when a ticket is paid for. Its
 * single-use code is the whole proof of purchase, minted by the only party that can know and pays
 * for each one. Separate from the session-authed portal: machine credential, volume, idempotent.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BASE_URL } from '../../config';
import { scanUrl } from '../../common/attribution';
import { str } from '../../common/security';
import { prisma } from '../../config/prisma';
import { newShortCode } from '../auth/tokens';
import { orgFromKey } from './api-key';

@ApiTags('Issuance API')
@ApiBearerAuth('apiKey')
@Controller('v1/issue')
export class IssueController {
  /**
   * Mint one code against one transaction. Idempotent on `issued_ref`: booking webhooks fire twice,
   * and two codes for one ticket is the promoter paying twice. The UNIQUE index is the guarantee.
   */
  @Post()
  async issue(
    @Headers('authorization') auth: string,
    @Body()
    b: {
      campaign_id: string;
      /** the promoter's own id for the purchase — a PNR, order number, receipt line */
      issued_ref: string;
      /** how long the traveller has to scan it; defaults to 30 days */
      expires_in_days?: number;
    },
  ) {
    const promoter = await orgFromKey(auth, 'promoter');
    const campaign_id = str(b.campaign_id, 'campaign_id', 36)!;
    const issued_ref = str(b.issued_ref, 'issued_ref', 200)!;
    const days = b.expires_in_days ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new BadRequestException('expires_in_days must be an integer 1–3650');

    // Ownership sits in the WHERE so another tenant's campaign is a 404, not a permission error — a
    // cross-tenant existence oracle leaks. `mode` too: an acquisition code never pays a purchase reward.
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaign_id,
        mode: 'engagement',
        status: 'active',
        partnership: { promoter_org_id: promoter.id, status: 'active' },
      },
      select: {
        id: true,
        // The publisher's App Clip slug decides the shape of the URL this code is printed as.
        partnership: { select: { publisher: { select: { slug: true } } } },
      },
    });
    if (!campaign)
      throw new NotFoundException('no active engagement campaign with that id');
    const slug = campaign.partnership.publisher.slug;

    // `max_uses: 1` is the single-use guarantee, claimed by the same atomic conditional UPDATE at `/r/:code`.
    try {
      const qr = await prisma.qrCode.create({
        data: {
          campaign_id,
          code: newShortCode(),
          issued_ref,
          max_uses: 1,
          expires_at: new Date(Date.now() + days * 86_400_000),
        },
        select: { id: true, code: true, expires_at: true },
      });
      return { ...qr, issued_ref, scan_url: scanUrl(BASE_URL, qr.code, slug), replay: false };
    } catch (e: any) {
      if (e.code !== 'P2002') throw e;
      // Same campaign and reference: the first call minted it. A 409 would make a correct issuance
      // look like something to reconcile by hand.
      const prior = await prisma.qrCode.findFirstOrThrow({
        where: { campaign_id, issued_ref },
        select: { id: true, code: true, expires_at: true },
      });
      return { ...prior, issued_ref, scan_url: scanUrl(BASE_URL, prior.code, slug), replay: true };
    }
  }

  /**
   * State of the code for one transaction — the reconciliation call: booking systems hold a PNR,
   * not our uuid, and re-POSTing `/v1/issue` replays the code without saying if it was scanned,
   * voided or paid. Query params, not a path: an `issued_ref` containing `/` would hit another route.
   */
  @Get()
  async status(
    @Headers('authorization') auth: string,
    @Query('campaign_id') campaign_id: string,
    @Query('issued_ref') issued_ref: string,
  ) {
    const promoter = await orgFromKey(auth, 'promoter');
    return this.find(promoter.id, campaign_id, issued_ref);
  }

  /**
   * Kill the code for a refund, cancellation or chargeback, else the promoter pays for a reversed
   * purchase. A refund webhook knows only the PNR, unlike the portal's uuid void; idempotent and
   * unaudited, as refunds are routine at booking volume. Not a clawback — a redeemed code stays
   * paid (`redeemed: true`).
   */
  @Post('void')
  async void(
    @Headers('authorization') auth: string,
    @Body() b: { campaign_id: string; issued_ref: string },
  ) {
    const promoter = await orgFromKey(auth, 'promoter');
    const found = await this.find(promoter.id, b.campaign_id, b.issued_ref);
    if (found.voided) return found; // already dead; say so rather than write again
    await prisma.qrCode.update({ where: { id: found.id }, data: { voided: true } });
    return { ...found, voided: true };
  }

  // One ownership-scoped lookup for both reads above. Campaign `mode`/`status` deliberately not
  // filtered as in `issue`: a promoter must be able to void a code on a campaign it has since paused.
  private async find(promoterId: string, campaignId: string, ref: string) {
    const campaign_id = str(campaignId, 'campaign_id', 36)!;
    const issued_ref = str(ref, 'issued_ref', 200)!;
    const qr = await prisma.qrCode.findFirst({
      where: {
        campaign_id,
        issued_ref,
        campaign: { partnership: { promoter_org_id: promoterId } },
      },
      select: {
        id: true,
        code: true,
        expires_at: true,
        voided: true,
        uses: true,
        campaign: {
          select: { partnership: { select: { publisher: { select: { slug: true } } } } },
        },
        // At most one: `UNIQUE (qr_code_id) WHERE kind = 'engagement'`; acquisition rows are NULL here.
        redemptions: { select: { id: true }, take: 1 },
      },
    });
    // Same 404 as `issue` gives another tenant, for the same reason.
    if (!qr) throw new NotFoundException('no code issued against that reference');
    const { redemptions, campaign, ...rest } = qr;
    return {
      ...rest,
      issued_ref,
      scan_url: scanUrl(BASE_URL, qr.code, campaign.partnership.publisher.slug),
      /** scanned and the reward paid — voiding cannot undo it */
      redeemed: redemptions.length > 0,
    };
  }
}

/**
 * The Issuance API: server-to-server, called by the *promoter's* own backend when a ticket is
 * paid for or a receipt prints.
 *
 * What comes back is one single-use code, and that code is the entire proof a purchase happened
 * — the only system that can know is the one that took the money. Minted by a party with no
 * incentive to invent them: the promoter pays for every code redeemed, out of its own budget.
 *
 * Its own controller because the portal is session-authenticated and built for a human; this is
 * a machine call on a different credential, at booking volume, and must be idempotent.
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
import { prisma } from '../../database/prisma';
import { newShortCode } from '../auth/tokens';
import { orgFromKey } from './api-key';

@ApiTags('Issuance API')
@ApiBearerAuth('apiKey')
@Controller('v1/issue')
export class IssueController {
  /**
   * Mint one code against one transaction. Idempotent on `issued_ref`, because a booking webhook
   * is exactly the kind of caller that fires twice — and two codes for one ticket is the promoter
   * paying twice. The UNIQUE index is the guarantee; this only turns the collision into the
   * original answer.
   */
  @Post()
  async issue(
    @Headers('authorization') auth: string,
    @Body()
    b: {
      campaign_id: string;
      /** the promoter's own id for the purchase — a PNR, an order number, a receipt line */
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

    // Ownership is inside the WHERE, so another tenant's campaign is a 404 rather than a
    // permission error — an existence oracle across tenants is itself a leak. `mode` too: a code
    // minted against an acquisition campaign scans fine, pays an acquisition fee once, then
    // silently never pays a purchase reward.
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

    // `max_uses: 1` is the whole single-use guarantee, claimed by the same atomic conditional
    // UPDATE every printed code already goes through at `/r/:code`.
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
        // Same campaign, same transaction reference: the first call already minted it. A 409
        // would make correctly-issued codes look like something to reconcile by hand.
      const prior = await prisma.qrCode.findFirstOrThrow({
        where: { campaign_id, issued_ref },
        select: { id: true, code: true, expires_at: true },
      });
      return { ...prior, issued_ref, scan_url: scanUrl(BASE_URL, prior.code, slug), replay: true };
    }
  }

  /**
   * What happened to the code minted against one transaction. The reconciliation call: a booking
   * system holds a PNR, not our uuid, and re-POSTing `/v1/issue` replays the code but says
   * nothing about whether it was scanned, voided or already paid for.
   *
   * Query parameters rather than a path, because an `issued_ref` with a `/` in it would silently
   * address a different route.
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
   * Kill the code for a transaction that stopped being one — a refund, a cancelled ticket, a
   * chargeback. Without it the promoter pays for a purchase that was reversed.
   *
   * The portal's void is a human clicking a row by uuid on a session; a refund is a webhook that
   * knows only the PNR. Idempotent, and deliberately not audited — a refund is routine at booking
   * volume and would bury the admin's inbox. Not a clawback either: a code already redeemed has
   * been paid for and stays paid, which is what `redeemed: true` in the answer says.
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

  /**
   * One ownership-scoped lookup for both reads above. Campaign `mode` and `status` are
   * deliberately not filtered the way `issue` filters them: a promoter must be able to kill a
   * code on a campaign it has since paused, which is exactly when a refund arrives.
   */
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
        // At most one: `UNIQUE (qr_code_id) WHERE kind = 'engagement'`, and acquisition rows
        // carry a NULL `qr_code_id`.
        redemptions: { select: { id: true }, take: 1 },
      },
    });
    // Same 404 as `issue` gives for another tenant's campaign, for the same reason.
    if (!qr) throw new NotFoundException('no code issued against that reference');
    const { redemptions, campaign, ...rest } = qr;
    return {
      ...rest,
      issued_ref,
      scan_url: scanUrl(BASE_URL, qr.code, campaign.partnership.publisher.slug),
      /** the code was scanned and the purchase reward has been paid — voiding cannot undo it */
      redeemed: redemptions.length > 0,
    };
  }
}

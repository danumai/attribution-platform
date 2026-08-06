/**
 * The Issuance API: server-to-server, called by the *promoter's* own backend.
 *
 * This is the half of the engagement flow that makes a repeat reward mean something. An
 * airline's booking system calls it the moment a ticket is paid for; a shop's POS calls it when
 * the receipt prints. What comes back is one single-use code, and that code is the entire proof
 * that a purchase happened — because the only system that can know a purchase happened is the
 * one that took the money.
 *
 * Everything the platform guarantees about an engagement campaign rests on that. "One reward
 * per code" is only "one reward per purchase" because codes are minted here, one per
 * transaction, by a party with no incentive to invent them: the promoter pays for every code
 * that gets redeemed, out of its own funded budget.
 *
 * Deliberately its own controller rather than another method on the promoter portal. That
 * portal is session-authenticated and built for a human designing print artwork — styles,
 * previews, a download. This is a machine call on a different credential, at booking volume,
 * and its answer must be idempotent. Same table underneath, different job entirely.
 */
import { BadRequestException, Body, Controller, Headers, NotFoundException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BASE_URL } from '../../config';
import { str } from '../../common/security';
import { prisma } from '../../database/prisma';
import { newShortCode } from '../auth/tokens';
import { orgFromKey } from './api-key';

@ApiTags('Issuance API')
@ApiBearerAuth('apiKey')
@Controller('v1/issue')
export class IssueController {
  /**
   * Mint one code against one transaction.
   *
   * Idempotent on `issued_ref`, and that is not a nicety — a booking webhook is exactly the
   * kind of caller that fires twice. A retried request must return the code the first call
   * made, or one traveller ends up holding two codes for one ticket and the promoter pays
   * twice for a purchase that happened once. The UNIQUE index is what guarantees it; this
   * handler only turns the collision into the original answer.
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

    // Ownership is inside the WHERE, so a campaign belonging to someone else is a 404 rather
    // than a permission error — an existence oracle across tenants is itself a leak.
    //
    // `mode` is part of it too. Minting a transaction code against an acquisition campaign
    // would produce a code that scans fine, pays an acquisition fee once, and then silently
    // never pays a purchase reward however many tickets the traveller buys. Refusing here is
    // the only place that mistake is cheap; after the boarding passes are printed it is not.
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaign_id,
        mode: 'engagement',
        status: 'active',
        partnership: { promoter_org_id: promoter.id, status: 'active' },
      },
      select: { id: true },
    });
    if (!campaign)
      throw new NotFoundException('no active engagement campaign with that id');

    // `max_uses: 1` is the whole single-use guarantee, and it is claimed by the same atomic
    // conditional UPDATE every printed code already goes through at `/r/:code`. Nothing new
    // guards this path — it is the existing one, asked for one use instead of unlimited.
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
      return { ...qr, issued_ref, scan_url: `${BASE_URL}/r/${qr.code}`, replay: false };
    } catch (e: any) {
      if (e.code !== 'P2002') throw e;
      // Same campaign, same transaction reference: the first call already minted it. Returning
      // that code is the honest answer — the caller asked for a code for this booking and
      // there is one. A 409 here would make correctly-issued codes look like something an
      // operator has to reconcile by hand, which is exactly what idempotency is for.
      const prior = await prisma.qrCode.findFirstOrThrow({
        where: { campaign_id, issued_ref },
        select: { id: true, code: true, expires_at: true },
      });
      return { ...prior, issued_ref, scan_url: `${BASE_URL}/r/${prior.code}`, replay: true };
    }
  }
}

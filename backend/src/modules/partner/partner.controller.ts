import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as jwt from 'jsonwebtoken';
import { sha256 } from '../../common/security';
import { ledger } from '../../database/ledger';
import { Tx, prisma } from '../../database/prisma';
import { JWT_SECRET } from '../auth/tokens';

async function publisherFromKey(auth: string) {
  const key = (auth ?? '').replace(/^Bearer /, '');
  if (!key.startsWith('pk_')) throw new UnauthorizedException('missing API key');
  const publisher = await prisma.org.findFirst({
    where: { type: 'publisher', api_key_hash: sha256(key) },
    select: { id: true, name: true },
  });
  if (!publisher) throw new UnauthorizedException('invalid API key');
  return publisher;
}

/** Lock a balance row for the rest of the transaction. Prisma has no `FOR UPDATE` builder. */
async function lockedBalance(tx: Tx, account: string): Promise<number> {
  const rows = await tx.$queryRaw<{ balance: number }[]>`
    SELECT balance FROM account_balances WHERE account = ${account} FOR UPDATE`;
  return rows[0]?.balance ?? 0;
}

@ApiTags('Partner API')
@ApiBearerAuth('apiKey')
@Controller('v1/redemptions')
export class PartnerController {
  @Post('verify')
  async verify(
    @Headers('authorization') auth: string,
    @Body() b: { scan_token: string; publisher_user_ref: string; identified?: boolean },
  ) {
    const publisher = await publisherFromKey(auth);
    if (!b.publisher_user_ref) throw new BadRequestException('publisher_user_ref required');

    let claims: any;
    try {
      claims = jwt.verify(b.scan_token ?? '', JWT_SECRET);
    } catch {
      throw new UnprocessableEntityException('scan token invalid or expired');
    }
    if (claims.kind !== 'scan') throw new UnprocessableEntityException('not a scan token');

    // campaign must belong to a partnership this publisher is party to
    const campaign = await prisma.campaign.findFirst({
      where: { id: claims.campaign_id, partnership: { publisher_org_id: publisher.id } },
      select: {
        id: true,
        status: true,
        partnership: { select: { coin_rate: true, guest_rate: true, grace_days: true } },
      },
    });
    if (!campaign) throw new UnauthorizedException('campaign not in your partnerships');
    if (campaign.status !== 'active') throw new ConflictException('campaign not active');
    const { coin_rate, guest_rate, grace_days } = campaign.partnership;

    // The publisher asserts identity against its own bar. Absent an explicit claim we pay
    // guest tier — the promoter should never pay full price for an unverified scan.
    const identified = b.identified === true;
    const coins = identified ? coin_rate : guest_rate;

    return prisma.$transaction(async (tx) => {
      // lock budget row; fail closed if exhausted
      if ((await lockedBalance(tx, `campaign:${campaign.id}`)) < coins)
        throw new ConflictException('budget_exhausted');
      // single-use scan token
      const consumed = await tx.scan.updateMany({
        where: { id: claims.scan_id, consumed: false },
        data: { consumed: true },
      });
      if (!consumed.count) throw new ConflictException('scan token already used');
      let red;
      try {
        red = await tx.redemption.create({
          data: {
            campaign_id: campaign.id,
            scan_id: claims.scan_id,
            publisher_user_ref: b.publisher_user_ref,
            coins,
            identified,
          },
          select: { id: true, coins: true },
        });
      } catch (e: any) {
        if (e.code === 'P2002') throw new ConflictException('duplicate_user');
        throw e;
      }
      const ref = `redemption:${red.id}`;
      await ledger(tx, `campaign:${campaign.id}`, -coins, ref);
      await ledger(tx, `publisher:${publisher.id}`, coins, ref);
      return {
        redemption_id: red.id,
        campaign_id: campaign.id,
        coins: red.coins,
        identified,
        status: 'granted',
        // what the user still stands to gain, and how long they have to claim it
        pending_coins: identified ? 0 : coin_rate - guest_rate,
        upgrade_deadline: identified
          ? null
          : new Date(Date.now() + grace_days * 86_400_000).toISOString(),
      };
    });
  }

  // Grace-period top-up: the held-back delta is released once the publisher confirms the
  // guest became an identified subscriber. Idempotent — a second call is a no-op.
  @Post(':id/upgrade')
  async upgrade(@Headers('authorization') auth: string, @Param('id') id: string) {
    const publisher = await publisherFromKey(auth);
    return prisma.$transaction(async (tx) => {
      // Raw: `FOR UPDATE OF rd` locks the redemption row across the join, which the query
      // builder cannot express, and the lock is what makes a concurrent double-upgrade safe.
      const rows = await tx.$queryRaw<
        {
          id: string;
          coins: number;
          identified: boolean;
          created_at: Date;
          campaign_id: string;
          coin_rate: number;
          grace_days: number;
        }[]
      >`
        SELECT rd.id, rd.coins, rd.identified, rd.created_at, rd.campaign_id,
               p.coin_rate, p.grace_days
        FROM redemptions rd
        JOIN campaigns c ON c.id = rd.campaign_id
        JOIN partnerships p ON p.id = c.partnership_id
        WHERE rd.id = ${id}::uuid AND p.publisher_org_id = ${publisher.id}::uuid
        FOR UPDATE OF rd`;
      const red = rows[0];
      if (!red) throw new NotFoundException('redemption not found');
      if (red.identified)
        return { redemption_id: red.id, coins: red.coins, identified: true, status: 'already_full' };

      const deadline = new Date(red.created_at).getTime() + red.grace_days * 86_400_000;
      if (Date.now() > deadline) throw new ConflictException('grace_period_expired');

      const delta = red.coin_rate - red.coins;
      if (delta > 0) {
        if ((await lockedBalance(tx, `campaign:${red.campaign_id}`)) < delta)
          throw new ConflictException('budget_exhausted');
        const ref = `upgrade:${red.id}`;
        await ledger(tx, `campaign:${red.campaign_id}`, -delta, ref);
        await ledger(tx, `publisher:${publisher.id}`, delta, ref);
      }
      await tx.redemption.update({
        where: { id: red.id },
        data: { coins: red.coin_rate, identified: true, upgraded_at: new Date() },
      });
      return {
        redemption_id: red.id,
        coins: red.coin_rate,
        coins_added: delta,
        identified: true,
        status: 'upgraded',
      };
    });
  }

  @Get(':id')
  async get(@Headers('authorization') auth: string, @Param('id') id: string) {
    const publisher = await publisherFromKey(auth);
    const red = await prisma.redemption.findFirst({
      where: { id, campaign: { partnership: { publisher_org_id: publisher.id } } },
    });
    if (!red) throw new NotFoundException();
    return red;
  }
}

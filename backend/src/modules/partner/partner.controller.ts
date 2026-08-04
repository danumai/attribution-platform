/**
 * The Partner API: server-to-server only, called by the publisher's own backend.
 *
 * This endpoint answers exactly one question — "is this new user attributable to a campaign?"
 * It never returns an instruction to grant currency, and it never hands anything back that a
 * device could redeem. What the publisher does with a `true` answer is the publisher's own
 * decision under its own new-user policy, funded by its own free-grant allowance.
 *
 * That separation is the compliance argument, and it is structural rather than cosmetic:
 * there is no code path here that could unlock anything inside an app even if a publisher
 * wanted it to.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FINGERPRINT_WINDOW_MIN, REFERRER_WINDOW_DAYS } from '../../config';
import { Platform, claimIdFromReferrer, detectPlatform } from '../../common/attribution';
import { ipHash, rateLimited, sha256, str } from '../../common/security';
import { ledger } from '../../database/ledger';
import { Tx, prisma } from '../../database/prisma';

async function publisherFromKey(auth: string) {
  const key = (auth ?? '').replace(/^Bearer /, '');
  if (!key.startsWith('pk_')) throw new UnauthorizedException('missing API key');
  const hash = sha256(key);
  // ponytail: in-process per-key ceiling, generous enough that no honest signup flow hits it.
  // Move to the shared Redis limiter when >1 instance runs, or it becomes N× this number.
  if (rateLimited(`partner:${hash}`, 600))
    throw new UnauthorizedException('rate limit exceeded, slow down');
  const publisher = await prisma.org.findFirst({
    // `suspended` matters here as much as it does at login: offboarding a publisher has to
    // stop its server earning fees immediately, and its API key never expires on its own.
    where: { type: 'publisher', api_key_hash: hash, suspended: false },
    select: { id: true, name: true, bonus_label: true },
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

interface ClaimableScan {
  id: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  coin_rate: number;
  guest_rate: number;
  grace_days: number;
}

/**
 * Deterministic path. Play's install referrer survived the install, so the claim id names
 * exactly one scan — no ambiguity, no collisions, and a long window is safe.
 *
 * `FOR UPDATE OF s SKIP LOCKED` rather than plain `FOR UPDATE`: two concurrent claims must
 * never queue up behind each other and then both proceed against the same row. The loser
 * skips it and comes back unattributed, which is the correct answer.
 */
const byReferrer = (tx: Tx, publisherId: string, claimId: string) =>
  tx.$queryRaw<ClaimableScan[]>`
    SELECT s.id, s.campaign_id, c.name AS campaign_name, c.status,
           p.coin_rate, p.guest_rate, p.grace_days
    FROM scans s
    JOIN campaigns c    ON c.id = s.campaign_id
    JOIN partnerships p ON p.id = c.partnership_id
    WHERE s.claim_id = ${claimId}
      AND s.consumed = false
      AND p.publisher_org_id = ${publisherId}::uuid
      AND p.status = 'active'
      AND s.scanned_at > now() - make_interval(days => ${REFERRER_WINDOW_DAYS})
    FOR UPDATE OF s SKIP LOCKED`;

/**
 * Probabilistic path — iOS, where no referrer channel exists at all.
 *
 * Matches on hashed IP plus platform only. Anything finer (full user agent, screen metrics)
 * differs between the mobile browser that scanned and the native app that opened, so it
 * would simply never match. Newest-first, because when a device shape does collide the most
 * recent scan is the likeliest true source.
 *
 * ponytail: two-signal fingerprint. Under carrier-grade NAT this will occasionally attribute
 * one household's install to a neighbour's scan. Tighten FINGERPRINT_WINDOW_MIN, or add
 * SKAdNetwork/AdAttributionKit as a third signal, if measured false-match rate matters.
 */
const byFingerprint = (tx: Tx, publisherId: string, fingerprint: string, platform: Platform) =>
  tx.$queryRaw<ClaimableScan[]>`
    SELECT s.id, s.campaign_id, c.name AS campaign_name, c.status,
           p.coin_rate, p.guest_rate, p.grace_days
    FROM scans s
    JOIN campaigns c    ON c.id = s.campaign_id
    JOIN partnerships p ON p.id = c.partnership_id
    WHERE s.consumed = false
      AND s.ip = ${fingerprint}
      AND s.platform = ${platform}
      AND p.publisher_org_id = ${publisherId}::uuid
      AND p.status = 'active'
      AND s.scanned_at > now() - make_interval(mins => ${FINGERPRINT_WINDOW_MIN})
    ORDER BY s.scanned_at DESC
    LIMIT 1
    FOR UPDATE OF s SKIP LOCKED`;

@ApiTags('Partner API')
@ApiBearerAuth('apiKey')
@Controller('v1/attribution')
export class PartnerController {
  /**
   * Called once, from the publisher's server, when a new user finishes signing up in the app.
   *
   * Unattributed is a normal answer, not an error: most installs are organic. It returns 200
   * with `attributed: false` so the publisher's signup path never has to treat this call as
   * a failure it must handle.
   */
  @Post('claim')
  @HttpCode(200)
  async claim(
    @Headers('authorization') auth: string,
    @Body()
    b: {
      publisher_user_ref: string;
      /** raw string from Play's Install Referrer API — the deterministic path */
      install_referrer?: string;
      /** device IP and UA seen at the app's first open — the iOS fallback path */
      ip?: string;
      user_agent?: string;
      platform?: string;
      /** the publisher asserting this user cleared its own verification bar */
      identified?: boolean;
    },
  ) {
    const publisher = await publisherFromKey(auth);
    // Bounded before anything is parsed or stored: `publisher_user_ref` becomes a unique-index
    // entry, and the rest are attacker-shaped strings from another company's server.
    const publisher_user_ref = str(b.publisher_user_ref, 'publisher_user_ref', 200)!;
    const install_referrer = str(b.install_referrer, 'install_referrer', 1000, false);
    const rawIp = str(b.ip, 'ip', 45, false); // 45 = longest possible IPv6 text form

    const claimId = claimIdFromReferrer(install_referrer);
    // The publisher reports its own client's signals; we hash the IP the same way the scan
    // path did so the two are comparable and neither side ever stores a raw address.
    const fingerprint = rawIp ? ipHash(rawIp) : null;
    const platform = (
      b.platform && ['android', 'ios', 'other'].includes(b.platform)
        ? b.platform
        : detectPlatform(str(b.user_agent, 'user_agent', 500, false) ?? '')
    ) as Platform;

    if (!claimId && !fingerprint)
      throw new BadRequestException('install_referrer or ip required to attribute an install');

    const unattributed = (reason: string) => ({
      attributed: false,
      reason,
      bonus_label: publisher.bonus_label,
    });

    // Set when the UNIQUE below fires, so the replay can be answered after the transaction
    // has rolled back — inside an aborted Postgres transaction no further query can run.
    let replayCampaignId: string | null = null;

    const fresh = await prisma.$transaction(async (tx) => {
      const rows = claimId
        ? await byReferrer(tx, publisher.id, claimId)
        : await byFingerprint(tx, publisher.id, fingerprint!, platform);
      const scan = rows[0];
      if (!scan) return unattributed('no_match');
      if (scan.status !== 'active') return unattributed('campaign_not_active');

      const identified = b.identified === true;
      const fee = identified ? scan.coin_rate : scan.guest_rate;

      // Fail closed on an exhausted budget. Unattributed rather than an error, because the
      // user has already signed up — the publisher's flow must not break over our accounting.
      if ((await lockedBalance(tx, `campaign:${scan.campaign_id}`)) < fee)
        return unattributed('budget_exhausted');

      // One install per scan. Guarded by the row lock above and re-checked here so a claim
      // can never be counted twice even if the lock were ever weakened.
      const consumed = await tx.scan.updateMany({
        where: { id: scan.id, consumed: false },
        data: { consumed: true },
      });
      if (!consumed.count) return unattributed('already_claimed');

      let red;
      try {
        red = await tx.redemption.create({
          data: {
            campaign_id: scan.campaign_id,
            scan_id: scan.id,
            publisher_user_ref,
            coins: fee,
            identified,
            match_method: claimId ? 'referrer' : 'fingerprint',
          },
          select: { id: true },
        });
      } catch (e: any) {
        // UNIQUE (campaign_id, publisher_user_ref): this user already counted for this
        // campaign. Roll the whole transaction back so the scan is not left consumed, and
        // answer from the existing row instead — see the replay note below.
        if (e.code === 'P2002') {
          replayCampaignId = scan.campaign_id;
          throw new ConflictException('duplicate_user');
        }
        throw e;
      }

      const ref = `redemption:${red.id}`;
      await ledger(tx, `campaign:${scan.campaign_id}`, -fee, ref);
      await ledger(tx, `publisher:${publisher.id}`, fee, ref);

      return {
        attributed: true,
        attribution_id: red.id,
        campaign_id: scan.campaign_id,
        campaign_name: scan.campaign_name,
        match_method: claimId ? 'referrer' : 'fingerprint',
        identified,
        /** marketing fee earned by the publisher, in platform credits. Not user currency. */
        fee,
        pending_fee: identified ? 0 : scan.coin_rate - scan.guest_rate,
        confirm_deadline: identified
          ? null
          : new Date(Date.now() + scan.grace_days * 86_400_000).toISOString(),
        /**
         * The publisher's own declared joining bonus, echoed back for their logs. This is a
         * label describing what they grant, never an instruction from this platform.
         */
        bonus_label: publisher.bonus_label,
        /** false on the first answer for this user; see the replay note on retries. */
        replay: false,
      };
    }).catch((e) => {
      if (replayCampaignId) return null; // handled below, as a replay rather than an error
      throw e;
    });
    if (fresh) return fresh;

    /**
     * Replay. This exact user was already attributed for this campaign, which in practice
     * almost always means the publisher's first call succeeded and its *response* was lost —
     * a timeout, a retried job, an at-least-once queue. Returning 409 there would make a
     * correctly-recorded attribution look like a failure the publisher must reconcile by hand,
     * so instead the original answer is replayed verbatim. Calling `claim` twice for one user
     * is safe by construction: the UNIQUE constraint, not this handler, is what guarantees the
     * fee was only ever paid once.
     */
    const prior = await prisma.redemption.findFirst({
      where: { campaign_id: replayCampaignId!, publisher_user_ref },
      include: { campaign: { select: { name: true, partnership: { select: { coin_rate: true, grace_days: true } } } } },
    });
    // Gone only if the campaign was deleted between the two calls; nothing left to replay.
    if (!prior) throw new ConflictException('duplicate_user');
    const { coin_rate, grace_days } = prior.campaign.partnership;
    return {
      attributed: true,
      attribution_id: prior.id,
      campaign_id: prior.campaign_id,
      campaign_name: prior.campaign.name,
      match_method: prior.match_method,
      identified: prior.identified,
      fee: prior.coins,
      pending_fee: prior.identified ? 0 : coin_rate - prior.coins,
      confirm_deadline: prior.identified
        ? null
        : new Date(prior.created_at.getTime() + grace_days * 86_400_000).toISOString(),
      bonus_label: publisher.bonus_label,
      replay: true,
    };
  }

  /**
   * Second leg: the user cleared the publisher's verification bar inside the grace period,
   * so the held-back part of the fee is released. Idempotent — a second call is a no-op.
   */
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(@Headers('authorization') auth: string, @Param('id') id: string) {
    const publisher = await publisherFromKey(auth);
    return prisma.$transaction(async (tx) => {
      // Raw: `FOR UPDATE OF rd` locks the attribution row across the join, which the query
      // builder cannot express, and the lock is what makes a concurrent double-confirm safe.
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
      if (!red) throw new NotFoundException('attribution not found');
      if (red.identified)
        return { attribution_id: red.id, fee: red.coins, identified: true, status: 'already_full' };

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
        attribution_id: red.id,
        fee: red.coin_rate,
        fee_added: delta,
        identified: true,
        status: 'confirmed',
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

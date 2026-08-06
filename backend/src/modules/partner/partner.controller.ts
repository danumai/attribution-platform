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
import {
  DEVICE_DEDUPE_DAYS,
  FINGERPRINT_WINDOW_MIN,
  MIN_CONFIDENCE,
  REFERRER_WINDOW_DAYS,
  SIGNUP_WINDOW_DAYS,
} from '../../config';
import {
  DeviceSignals,
  Platform,
  claimIdFromReferrer,
  decide,
  detectPlatform,
  normCores,
  normDark,
  normLang,
  normScreen,
  normTz,
} from '../../common/attribution';
import { ipHash, rateLimited, sha256, str } from '../../common/security';
import { ledger, lockedBalance } from '../../database/ledger';
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

interface ClaimableScan {
  id: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  coin_rate: number;
  guest_rate: number;
  grace_days: number;
  /** the scan's stored device signals, scored against the ones presented at first open */
  tz: string | null;
  screen: string | null;
  language: string | null;
  cores: number | null;
  dark: boolean | null;
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
           p.coin_rate, p.guest_rate, p.grace_days,
           s.tz, s.screen, s.language, s.cores, s.dark
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
 * Hashed IP + platform is the *filter*, not the answer. It narrows the table to scans that
 * could plausibly be this device; on carrier-grade NAT, café wifi or a corporate VPN that can
 * still be dozens of unrelated handsets, which is precisely why the caller then scores the
 * candidates on signals that describe the phone rather than the network it sat on.
 *
 * ponytail: 20-candidate ceiling. Behind a NAT busy enough to produce more unmatched scans
 * than that in one window, the 21st is invisible — raise it, or narrow the window, if a
 * deployment ever measures matches being lost here rather than merely being ambiguous.
 */
const fingerprintCandidates = (
  tx: Tx,
  publisherId: string,
  fingerprint: string,
  platform: Platform,
) =>
  tx.$queryRaw<ClaimableScan[]>`
    SELECT s.id, s.campaign_id, c.name AS campaign_name, c.status,
           p.coin_rate, p.guest_rate, p.grace_days,
           s.tz, s.screen, s.language, s.cores, s.dark
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
    LIMIT 20
    FOR UPDATE OF s SKIP LOCKED`;

/** Everything a publisher's server can tell us about a device at first open. */
interface OpenSignals extends DeviceSignals {
  claimId: string | null;
  fingerprint: string | null;
  platform: Platform;
}

/**
 * Parse and bound the device half of a request body. Every field here crosses a trust
 * boundary — it arrives from another company's server — so nothing is stored before it has
 * been through `str()` for length and the `norm*` helpers for shape.
 */
function readSignals(b: Record<string, unknown>): OpenSignals {
  const install_referrer = str(b.install_referrer, 'install_referrer', 1000, false);
  // An SDK that banked the claim id itself, rather than the whole referrer string, can present
  // it bare. Wrapped back into referrer shape instead of re-validated here, so there is exactly
  // one definition of what a claim id may look like.
  //
  // A malformed one is a 400, never a silent drop: falling through to the fingerprint path
  // would turn a broken deterministic lookup into a guess, which is precisely what `matchScan`
  // refuses to do a few lines down.
  const raw = str(b.claim_id, 'claim_id', 64, false);
  const bare = raw ? claimIdFromReferrer(`qrm_claim=${raw}`) : null;
  if (raw && !bare)
    throw new BadRequestException('claim_id must be the opaque id from the install referrer');
  const rawIp = str(b.ip, 'ip', 45, false); // 45 = longest possible IPv6 text form
  const platform =
    typeof b.platform === 'string' && ['android', 'ios', 'other'].includes(b.platform)
      ? (b.platform as Platform)
      : detectPlatform(str(b.user_agent, 'user_agent', 500, false) ?? '');
  return {
    claimId: bare ?? claimIdFromReferrer(install_referrer),
    // The publisher reports its own client's address; we hash it the same way the scan path
    // did so the two are comparable and neither side ever stores a raw address.
    fingerprint: rawIp ? ipHash(rawIp) : null,
    platform,
    tz: normTz(str(b.tz, 'tz', 64, false)),
    screen: normScreen(str(b.screen, 'screen', 32, false)),
    language: normLang(str(b.language, 'language', 32, false)),
    // Both are optional for an SDK that has not been updated yet: a missing signal simply
    // earns nothing, exactly as a missing timezone always has. Neither may ever be *required*,
    // or upgrading the SDK would become the thing that decides who gets paid.
    cores: normCores(b.cores),
    dark: normDark(b.dark),
  };
}

/**
 * One handset, as far as these signals can tell. Only ever computed for probabilistic
 * matches — a claim id is already unique per scan, so the repeat-device question is answered
 * there by the scan itself.
 *
 * ponytail: this is a *device shape*, not a device. Two identical handsets on one NAT with
 * the same locale hash the same, which is why the repeat check it feeds refuses an install
 * rather than banning anything, and why `DEVICE_DEDUPE_DAYS` can be turned off entirely.
 */
const deviceHash = (s: OpenSignals) =>
  sha256(
    [s.fingerprint, s.platform, s.tz, s.screen, s.language, s.cores, s.dark].join('|'),
  ).slice(0, 32);

type Match =
  | { scan: ClaimableScan; confidence: number; match_method: 'referrer' | 'fingerprint' }
  | { reason: string; confidence?: number };

/**
 * Answer `unattributed`, but roll the transaction back first.
 *
 * `claimInstall` and `claimAtSignup` both flip their guard (`redeemed` / `consumed`) *before*
 * the budget is known — the fee depends on `identified`, which is only resolved once the match
 * is in hand. Returning normally from the transaction callback commits that flip, so a signup
 * that arrives one credit short of the budget permanently burned the install: topping the
 * campaign back up could never make that user attributable again, and the publisher had
 * already created the account.
 *
 * `firstOpen` avoids this by checking the budget before it consumes anything. Here that is not
 * available, so the rollback is the guard instead.
 */
class Rollback extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

/**
 * Find the scan this install came from, or refuse.
 *
 * Deterministic first, and never a fallback from it: when a claim id is presented and does not
 * resolve, the referrer named a scan that is gone, already claimed, or belongs to a different
 * publisher. Quietly re-matching that device on IP would turn a failed exact lookup into a
 * guess — which is the single thing this path must never do. Scoring lives in `decide()`.
 */
async function matchScan(tx: Tx, publisherId: string, open: OpenSignals): Promise<Match> {
  if (open.claimId) {
    const rows = await byReferrer(tx, publisherId, open.claimId);
    return rows[0]
      ? { scan: rows[0], confidence: 100, match_method: 'referrer' }
      : { reason: 'no_match' };
  }
  const rows = await fingerprintCandidates(tx, publisherId, open.fingerprint!, open.platform);
  const d = decide(rows, open, MIN_CONFIDENCE);
  return 'reason' in d ? d : { ...d, match_method: 'fingerprint' };
}

/**
 * Signup on the preferred path: the match already happened at first open, so this only has to
 * check the install is still spendable and hand back the decision that was recorded then.
 *
 * `redeemed` is flipped inside the same `updateMany` that tests it, which is what makes two
 * simultaneous signups for one install safe — the loser sees `count === 0`. Same trick the
 * scan path uses with `consumed`, for the same reason.
 *
 * The scan is deliberately *not* re-matched here. Re-running the matcher at signup would
 * reintroduce exactly the bug the install stage exists to fix, and the scan is long consumed.
 */
async function claimInstall(tx: Tx, publisherId: string, installId: string): Promise<Match> {
  // `::uuid` on a caller-supplied string throws 22P02 on a malformed value rather than
  // returning empty, so the shape is checked before Postgres is asked to parse it.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(installId))
    return { reason: 'no_match' };

  const rows = await tx.$queryRaw<
    (ClaimableScan & { install_expired: boolean; confidence: number; match_method: string })[]
  >`
    SELECT s.id, s.campaign_id, c.name AS campaign_name, c.status,
           p.coin_rate, p.guest_rate, p.grace_days,
           s.tz, s.screen, s.language, s.cores, s.dark,
           i.confidence, i.match_method, (i.expires_at <= now()) AS install_expired
    FROM installs i
    JOIN scans s        ON s.id = i.scan_id
    JOIN campaigns c    ON c.id = i.campaign_id
    JOIN partnerships p ON p.id = c.partnership_id
    WHERE i.id = ${installId}::uuid
      AND i.publisher_org_id = ${publisherId}::uuid
      AND p.status = 'active'
    FOR UPDATE OF i`;
  const row = rows[0];
  if (!row) return { reason: 'no_match' };
  if (row.install_expired) return { reason: 'install_expired' };
  // Checked again here, not just at first open. Ending or pausing a campaign has to stop
  // spending immediately, and installs bound while it was live can otherwise keep drawing on
  // a funded budget for the whole signup window after the promoter thought they had stopped.
  if (row.status !== 'active') return { reason: 'campaign_not_active' };

  const taken = await tx.install.updateMany({
    where: { id: installId, redeemed: false },
    data: { redeemed: true },
  });
  if (!taken.count) return { reason: 'already_claimed' };

  return {
    scan: row,
    confidence: row.confidence,
    match_method: row.match_method as 'referrer' | 'fingerprint',
  };
}

/**
 * Signup on the legacy single-call path: match and pay in one request, with no install row.
 *
 * Kept working for publishers already integrated, and it now runs the same scored matcher —
 * so a bare IP + platform scores 55, falls under `MIN_CONFIDENCE` and is refused here exactly
 * as it is at first open. That is a deliberate behaviour change: this path used to pay on it.
 */
async function claimAtSignup(tx: Tx, publisherId: string, open: OpenSignals): Promise<Match> {
  const m = await matchScan(tx, publisherId, open);
  if ('reason' in m) return m;
  if (m.scan.status !== 'active') return { reason: 'campaign_not_active' };

  // No install row to guard with, so the scan itself is the guard — same atomic test-and-set.
  const consumed = await tx.scan.updateMany({
    where: { id: m.scan.id, consumed: false },
    data: { consumed: true },
  });
  if (!consumed.count) return { reason: 'already_claimed' };
  return m;
}

@ApiTags('Partner API')
@ApiBearerAuth('apiKey')
@Controller('v1/attribution')
export class PartnerController {
  /**
   * Stage one: the app has just opened for the first time. Nothing is paid here.
   *
   * This exists because matching and paying happen at different moments and the old single
   * call pretended otherwise. First open is minutes after the scan — while the device is
   * still on the same network, still in the same timezone, still the same shape. Signup is
   * whenever the user gets round to it, which on a content app is routinely the next day.
   * Matching at signup forced one window to cover both, and the fingerprint path could not
   * survive that: short enough to be honest meant it matched almost nothing.
   *
   * So the publisher's server calls this at launch, banks the `install_id`, and presents it
   * again at signup. The scan is consumed here — the claim is bound — but no ledger entry
   * exists until somebody actually signs up.
   *
   * Idempotent by construction: a second call for the same device finds the scan already
   * consumed and comes back `no_match`, so the SDK must persist `install_id` locally rather
   * than re-deriving it. An install that is never signed up simply expires.
   */
  @Post('first-open')
  @HttpCode(200)
  async firstOpen(
    @Headers('authorization') auth: string,
    @Body()
    b: {
      /** raw string from Play's Install Referrer API — the deterministic path */
      install_referrer?: string;
      /** the claim id alone, if the SDK already parsed or stored it — same deterministic path */
      claim_id?: string;
      /** device signals seen at first open — the probabilistic path */
      ip?: string;
      user_agent?: string;
      platform?: string;
      /** IANA zone, e.g. `Asia/Dhaka` */
      tz?: string;
      /** `{short}x{long}@{dpr}`, orientation-normalised */
      screen?: string;
      language?: string;
      /** device integrity, as asserted by the SDK. See the handling note below. */
      emulator?: boolean;
      rooted?: boolean;
      vpn?: boolean;
    },
  ) {
    const publisher = await publisherFromKey(auth);
    const open = readSignals(b as Record<string, unknown>);
    if (!open.claimId && !open.fingerprint)
      throw new BadRequestException('install_referrer or ip required to attribute an install');

    /**
     * Device integrity is *asserted* by the SDK, never observed by us, so it is graded rather
     * than trusted uniformly:
     *
     *   emulator  blocks. Nobody installs a consumer content app on an emulator by accident;
     *             this is the shape of every install farm and the signal is cheap to act on.
     *   rooted    recorded only. Rooted and jailbroken handsets have a large honest
     *             population, and refusing them would deny real users a real reward.
     *   vpn       recorded only — and note it is not really a fraud signal here at all. A VPN
     *             changes the address between scan and open, so the fingerprint simply fails
     *             to match. Recording it is what lets someone reviewing a `no_match` rate see
     *             why, rather than concluding the matcher is broken.
     *
     * All three are stored on accepted installs too. The pattern worth finding is the one
     * that got paid.
     */
    const risk = {
      emulator: b.emulator === true,
      rooted: b.rooted === true,
      vpn: b.vpn === true,
    };
    if (risk.emulator) return { attributed: false, reason: 'device_integrity' };

    return prisma.$transaction(async (tx) => {
      const m = await matchScan(tx, publisher.id, open);
      if ('reason' in m) return { attributed: false, reason: m.reason, confidence: m.confidence };
      const { scan, confidence, match_method } = m;
      if (scan.status !== 'active') return { attributed: false, reason: 'campaign_not_active' };

      // Bind nothing against a campaign that cannot pay. The signup that follows would only
      // fail on budget anyway, and it would have burned the scan getting there — leaving a
      // real scanner permanently unattributable once the promoter tops the budget back up.
      if ((await lockedBalance(tx, `campaign:${scan.campaign_id}`)) < scan.guest_rate)
        return { attributed: false, reason: 'budget_exhausted' };

      // The repeat-device check, and only on the probabilistic path: a referrer match already
      // names one specific scan, so two family members scanning the same poster on the same
      // wifi are two legitimate claim ids that must not be collapsed into one "device".
      const device_hash = match_method === 'fingerprint' ? deviceHash(open) : null;
      if (device_hash && DEVICE_DEDUPE_DAYS > 0) {
        const repeats = await tx.install.count({
          where: {
            campaign_id: scan.campaign_id,
            device_hash,
            first_open_at: { gt: new Date(Date.now() - DEVICE_DEDUPE_DAYS * 86_400_000) },
          },
        });
        if (repeats) return { attributed: false, reason: 'duplicate_device', confidence };
      }

      // One install per scan. The row is already locked by the matcher; this is the same
      // re-check the old code did, kept because it is what makes the guarantee independent
      // of the lock rather than a consequence of it.
      const consumed = await tx.scan.updateMany({
        where: { id: scan.id, consumed: false },
        data: { consumed: true },
      });
      if (!consumed.count) return { attributed: false, reason: 'already_claimed' };

      const expires_at = new Date(Date.now() + SIGNUP_WINDOW_DAYS * 86_400_000);
      const install = await tx.install.create({
        data: {
          scan_id: scan.id,
          campaign_id: scan.campaign_id,
          publisher_org_id: publisher.id,
          match_method,
          confidence,
          device_hash,
          risk,
          expires_at,
        },
        select: { id: true },
      });

      return {
        attributed: true,
        /** present this at signup. Not a credential and not spendable — it names an install. */
        install_id: install.id,
        campaign_id: scan.campaign_id,
        campaign_name: scan.campaign_name,
        match_method,
        /** 0–100. 100 is Play's referrer; below that, how many device signals agreed. */
        confidence,
        signup_deadline: expires_at.toISOString(),
        bonus_label: publisher.bonus_label,
      };
    });
  }

  /**
   * Stage two: a new user finished signing up, so the fee is earned.
   *
   * Preferred shape is `{ install_id, publisher_user_ref }` — the match already happened at
   * first open and this call only turns it into money.
   *
   * The device fields are the legacy single-call shape, kept working for publishers already
   * integrated against it. They run the same matcher at signup time, which means the same
   * short fingerprint window now has to stretch across onboarding: on Android the referrer
   * makes that irrelevant, on iOS it is why this path barely attributed anything. Move.
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
      /** preferred: the id `first-open` returned for this device */
      install_id?: string;
      /** legacy single-call shape: raw string from Play's Install Referrer API */
      install_referrer?: string;
      /** legacy single-call shape: the claim id alone, as the SDK stored it */
      claim_id?: string;
      /** legacy single-call shape: device signals seen at first open */
      ip?: string;
      user_agent?: string;
      platform?: string;
      tz?: string;
      screen?: string;
      language?: string;
      /**
       * The publisher asserting this signup created a brand-new account. Only `false` acts —
       * an omitted field stays attributable, so publishers integrated before this existed are
       * unaffected. See the refusal note in the handler.
       */
      is_new_user?: boolean;
      /** the publisher asserting this user cleared its own verification bar */
      identified?: boolean;
    },
  ) {
    const publisher = await publisherFromKey(auth);
    // Bounded before anything is parsed or stored: `publisher_user_ref` becomes a unique-index
    // entry, and the rest are attacker-shaped strings from another company's server.
    const publisher_user_ref = str(b.publisher_user_ref, 'publisher_user_ref', 200)!;
    const install_id = str(b.install_id, 'install_id', 36, false);

    const open = install_id ? null : readSignals(b as Record<string, unknown>);
    if (open && !open.claimId && !open.fingerprint)
      throw new BadRequestException(
        'install_id, or install_referrer/ip, required to attribute a signup',
      );

    const unattributed = (reason: string) => ({
      attributed: false,
      reason,
      bonus_label: publisher.bonus_label,
    });

    /**
     * The fee buys an *acquisition*, so an existing account signing in again is not one. Only
     * the publisher can know that — we see a `publisher_user_ref`, not an account age — so it
     * is asserted here, and refused before the install is spent: an install burned on a
     * returning user would be unclaimable afterwards for no reason.
     *
     * The UNIQUE on (campaign, publisher_user_ref) still catches the same *ref* twice; this
     * catches the case that constraint cannot see — a returning user handed a fresh ref.
     */
    if (b.is_new_user === false) return unattributed('not_a_new_user');

    // Set when the UNIQUE below fires, so the replay can be answered after the transaction
    // has rolled back — inside an aborted Postgres transaction no further query can run.
    let replayCampaignId: string | null = null;

    const fresh = await prisma.$transaction(async (tx) => {
      const resolved = install_id
        ? await claimInstall(tx, publisher.id, install_id)
        : await claimAtSignup(tx, publisher.id, open!);
      if ('reason' in resolved) return unattributed(resolved.reason);
      const { scan, confidence, match_method } = resolved;

      const identified = b.identified === true;
      const fee = identified ? scan.coin_rate : scan.guest_rate;

      // Fail closed on an exhausted budget. Unattributed rather than an error, because the
      // user has already signed up — the publisher's flow must not break over our accounting.
      // Thrown rather than returned so the install/scan is released: see `Rollback`.
      if ((await lockedBalance(tx, `campaign:${scan.campaign_id}`)) < fee)
        throw new Rollback('budget_exhausted');

      let red;
      try {
        red = await tx.redemption.create({
          data: {
            campaign_id: scan.campaign_id,
            scan_id: scan.id,
            install_id,
            publisher_user_ref,
            coins: fee,
            identified,
            match_method,
            confidence,
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
        match_method,
        confidence,
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
      // Rolled back on purpose, and the caller still gets a 200 — the transaction was undone
      // so the install stays claimable once the promoter tops the budget back up.
      if (e instanceof Rollback) return unattributed(e.reason);
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
      confidence: prior.confidence,
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
          partnership_status: string;
        }[]
      >`
        SELECT rd.id, rd.coins, rd.identified, rd.created_at, rd.campaign_id,
               p.coin_rate, p.grace_days, p.status AS partnership_status
        FROM redemptions rd
        JOIN campaigns c ON c.id = rd.campaign_id
        JOIN partnerships p ON p.id = c.partnership_id
        WHERE rd.id = ${id}::uuid AND p.publisher_org_id = ${publisher.id}::uuid
        FOR UPDATE OF rd`;
      const red = rows[0];
      if (!red) throw new NotFoundException('attribution not found');
      // The one money path that was not checking this. Suspending a partnership is documented
      // as stopping scans *and* payouts, and every other spend — the redirect, first-open and
      // both claim paths — filters on it in SQL. Without it the upgrade delta stayed payable,
      // so an admin freezing a relationship still let up to `coin_rate - guest_rate` per
      // outstanding guest redemption leave the campaign budget for the whole grace window.
      // Surfaced rather than filtered out in the WHERE: a publisher deserves a reason here,
      // not a 404 that reads like a lost attribution.
      if (red.partnership_status !== 'active')
        throw new ConflictException('partnership_not_active');
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

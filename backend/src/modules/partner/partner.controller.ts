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
import { REFERRER_WINDOW_DAYS, SIGNUP_WINDOW_DAYS } from '../../config';
import {
  bonusLabel,
  bonusesFor,
  campaignBonuses,
  claimIdFromReferrer,
  codeFromReferrer,
} from '../../common/attribution';
import { recordDecision } from '../../common/obs';
import { splitFee } from '../../common/rates';
import { sha256, str } from '../../common/security';
import { lockedBalance, payout } from '../../database/ledger';
import { Tx, prisma } from '../../database/prisma';
import { orgFromKey } from './api-key';

const publisherFromKey = (auth: string) => orgFromKey(auth, 'publisher');

interface ClaimableScan {
  id: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  /** the offers this campaign advertises — publisher slugs, resolved through `campaignBonuses` */
  bonus_types: string[];
  coin_rate: number;
  guest_rate: number;
  grace_days: number;
  /** basis points of the payout the platform retains, snapshotted on the partnership */
  platform_fee_bps: number;
}

/**
 * The only lookup. A claim id names exactly one scan whichever carrier brought it back —
 * Play's referrer, an App Clip's shared container, or the pasteboard — so there is no
 * ambiguity to resolve, no collisions to score, and one long window is safe for all of them.
 *
 * `FOR UPDATE OF s SKIP LOCKED` rather than plain `FOR UPDATE`: two concurrent claims must
 * never queue up behind each other and then both proceed against the same row. The loser
 * skips it and comes back unattributed, which is the correct answer.
 */
const byClaimId = (tx: Tx, publisherId: string, claimId: string) =>
  tx.$queryRaw<ClaimableScan[]>`
    SELECT s.id, s.campaign_id, c.name AS campaign_name, c.status, c.bonus_types,
           p.coin_rate, p.guest_rate, p.grace_days, p.platform_fee_bps
    FROM scans s
    JOIN campaigns c    ON c.id = s.campaign_id
    JOIN partnerships p ON p.id = c.partnership_id
    WHERE s.claim_id = ${claimId}
      AND s.consumed = false
      AND p.publisher_org_id = ${publisherId}::uuid
      AND p.status = 'active'
      AND s.scanned_at > now() - make_interval(days => ${REFERRER_WINDOW_DAYS})
    FOR UPDATE OF s SKIP LOCKED`;

/** What the publisher's SDK carried back from the scan. One field, and how it travelled. */
interface Carried {
  claimId: string | null;
  /** which channel produced it — reporting only; the lookup is identical for all three */
  carrier: MatchMethod;
}

/** The carriers, and the only values `match_method` is ever written with. */
type MatchMethod = 'referrer' | 'appclip' | 'pasteboard';
const CARRIERS = ['referrer', 'appclip', 'pasteboard'] as const;

/**
 * Parse and bound the claim half of a request body. It crosses a trust boundary — it arrives
 * from another company's server — so nothing is used before `str()` has bounded its length and
 * `claimIdFromReferrer` has confirmed its shape.
 *
 * Note what is no longer read: IP, timezone, screen, locale, core count, appearance. Those were
 * the iOS fingerprint. A publisher SDK still sending them is not an error — the fields are
 * simply ignored, so an un-upgraded integration degrades to "no claim carried" rather than
 * breaking, and `first-open` answers `no_match` until it ships the new SDK.
 */
function readCarried(b: Record<string, unknown>): Carried {
  const install_referrer = str(b.install_referrer, 'install_referrer', 1000, false);
  // An SDK that banked the claim id itself, rather than the whole referrer string, can present
  // it bare. Wrapped back into referrer shape instead of re-validated here, so there is exactly
  // one definition of what a claim id may look like.
  //
  // A malformed one is a 400, never a silent drop: it means the carrier delivered something,
  // and quietly discarding it would turn a broken integration into an attribution rate of zero
  // with no error to find it by.
  const raw = str(b.claim_id, 'claim_id', 64, false);
  const bare = raw ? claimIdFromReferrer(`qrm_claim=${raw}`) : null;
  if (raw && !bare)
    throw new BadRequestException('claim_id must be the opaque id the scan issued');

  // How it travelled. Asserted by the SDK and believed, because it decides nothing: every
  // carrier resolves through the same lookup and pays the same fee. It is recorded so a
  // publisher whose App Clip is misconfigured shows up as a column of `pasteboard` rather
  // than as a number nobody can explain.
  //
  // An SDK that says nothing is recorded as `referrer` — which is both the value this endpoint
  // has always returned for a bare claim id, so no existing integration changes shape, and the
  // only honest one: `appclip` and `pasteboard` are the more specific claims, and asserting
  // either without being told would be inventing the very fact this column exists to report.
  const claimed = str(b.carrier, 'carrier', 20, false);
  const carrier = (CARRIERS as readonly string[]).includes(claimed ?? '')
    ? (claimed as MatchMethod)
    : 'referrer';

  return { claimId: bare ?? claimIdFromReferrer(install_referrer), carrier };
}

type Match =
  | { scan: ClaimableScan; confidence: number; match_method: MatchMethod }
  | { reason: string; confidence?: number };

/**
 * Answer `unattributed`, but roll the transaction back first.
 *
 * `claimInstall` and `claimAtSignup` flip their guard (`redeemed` / `consumed`) *before* the
 * budget is known, because the fee depends on `identified`. Returning normally would commit
 * that flip, so a signup arriving one credit short of the budget would permanently burn the
 * install — topping the campaign back up could never make that user attributable again.
 *
 * `firstOpen` checks the budget before consuming anything; here the rollback is the guard.
 */
class Rollback extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

/**
 * Find the scan this install came from, or refuse.
 *
 * There is no fallback, and that absence is the design. A claim id that does not resolve names
 * a scan that is gone, already claimed, or belongs to a different publisher — and the honest
 * answer to all three is `no_match`. The path this replaced answered a failed exact lookup by
 * guessing from the network the phone sat on, which is both the thing Apple forbids and the
 * thing that paid one publisher for another's scan.
 *
 * `confidence` is 100 on every answer because every carrier names one exact scan. It stays in
 * the response so publishers integrated against the old shape keep reading the field they
 * already read.
 */
async function matchScan(tx: Tx, publisherId: string, carried: Carried): Promise<Match> {
  if (!carried.claimId) return { reason: 'no_claim' };
  const rows = await byClaimId(tx, publisherId, carried.claimId);
  return rows[0]
    ? { scan: rows[0], confidence: 100, match_method: carried.carrier }
    : { reason: 'no_match' };
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
    SELECT s.id, s.campaign_id, c.name AS campaign_name, c.status, c.bonus_types,
           p.coin_rate, p.guest_rate, p.grace_days, p.platform_fee_bps,
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
    match_method: row.match_method as MatchMethod,
  };
}

/** What an engagement claim resolves to: one issued code, its scan, and what it pays. */
interface ClaimableCode {
  qr_code_id: string;
  scan_id: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  /** the offers this campaign advertises — publisher slugs, resolved through `campaignBonuses` */
  bonus_types: string[];
  engagement_rate: number;
  platform_fee_bps: number;
}

/**
 * The engagement path: a code minted against one real purchase, scanned once, paid once.
 *
 * There is no matching to do, and that is the point. `match_method` is `code` and confidence is
 * 100 because the code names a *purchase* rather than a device — stronger evidence than a
 * referrer, not a flattering label.
 *
 * Note what is deliberately NOT checked: `scans.consumed`. That flag is the acquisition guard,
 * and an engagement reward is a different fact about the same scan — a traveller who scans a
 * boarding pass, installs, signs up and has bought a ticket earns both, payably. Sharing one
 * flag would make them race. The engagement guarantee is its own partial unique index.
 */
async function claimCode(tx: Tx, publisherId: string, code: string): Promise<ClaimableCode | { reason: string }> {
  // `FOR UPDATE OF q` holds the code row for the rest of the transaction, so two simultaneous
  // claims for one boarding pass serialise here rather than both reaching the INSERT and
  // relying on the unique index to tell one of them it lost.
  const rows = await tx.$queryRaw<(ClaimableCode & { mode: string })[]>`
    SELECT q.id AS qr_code_id, s.id AS scan_id, c.id AS campaign_id, c.name AS campaign_name,
           c.status, c.mode, c.bonus_types, p.engagement_rate, p.platform_fee_bps
    FROM qr_codes q
    JOIN scans s        ON s.qr_code_id = q.id
    JOIN campaigns c    ON c.id = q.campaign_id
    JOIN partnerships p ON p.id = c.partnership_id
    WHERE q.code = ${code}
      AND NOT q.voided
      AND p.publisher_org_id = ${publisherId}::uuid
      AND p.status = 'active'
      AND s.scanned_at > now() - make_interval(days => ${REFERRER_WINDOW_DAYS})
    ORDER BY s.scanned_at DESC
    LIMIT 1
    FOR UPDATE OF q`;
  const row = rows[0];
  // No row covers four different situations on purpose — an unknown code, a voided one, one
  // belonging to another publisher, and one nobody has actually scanned yet. Telling them
  // apart would let a publisher probe which codes exist across the whole platform.
  if (!row) return { reason: 'no_match' };
  // An acquisition campaign has no repeat-purchase price and never agreed to pay one. This is
  // the refusal a publisher sees if it sends a `code` from the wrong kind of campaign.
  if (row.mode !== 'engagement') return { reason: 'not_engagement' };
  // Re-checked here and not only at scan time: ending or pausing a campaign has to stop
  // spending now, and a code scanned while it was live otherwise stays payable for the whole
  // window after the promoter thought they had stopped.
  if (row.status !== 'active') return { reason: 'campaign_not_active' };
  return row;
}

/**
 * Signup on the legacy single-call path: match and pay in one request, with no install row.
 *
 * Kept working for publishers already integrated. It runs the same deterministic lookup, so
 * the window question the two-stage path exists to answer does not arise here either — a
 * claim id is as good on day 30 as on minute one.
 */
async function claimAtSignup(tx: Tx, publisherId: string, carried: Carried): Promise<Match> {
  const m = await matchScan(tx, publisherId, carried);
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
   * Matching and paying happen at different moments. The claim id is available at launch, in
   * whichever carrier brought it across the install, and it is only readable then: an App
   * Clip's shared container is migrated once, and the pasteboard holds one thing at a time.
   * Signup is whenever the user gets round to it, routinely the next day.
   *
   * So the publisher's server calls this at launch, banks the `install_id`, and presents it
   * again at signup. The scan is consumed here — the claim is bound — but no ledger entry
   * exists until somebody signs up.
   *
   * Idempotent by construction: a second call finds the scan already consumed and comes back
   * `no_match`, so the SDK must persist `install_id` rather than re-derive it.
   */
  @Post('first-open')
  @HttpCode(200)
  async firstOpen(
    @Headers('authorization') auth: string,
    @Body()
    b: {
      /** raw string from Play's Install Referrer API — Android */
      install_referrer?: string;
      /** the claim id alone: what the App Clip container or the pasteboard handed the app */
      claim_id?: string;
      /** `referrer` | `appclip` | `pasteboard`. Reporting only; inferred when absent. */
      carrier?: string;
      /** device integrity, as asserted by the SDK. See the handling note below. */
      emulator?: boolean;
      rooted?: boolean;
      vpn?: boolean;
    },
  ) {
    const publisher = await publisherFromKey(auth);
    // What a *refusal* carries: everything this publisher grants for a signup. No campaign is
    // known on those answers, so nothing narrower is available — and an SDK that shows the
    // offer while it retries is showing what the publisher runs, not what one poster promised.
    // An attributed answer replaces this with the campaign's own pick; see `granted` below.
    const bonuses = bonusesFor(publisher.bonuses, 'acquisition');
    const carried = readCarried(b as Record<string, unknown>);
    if (!carried.claimId)
      throw new BadRequestException(
        'install_referrer or claim_id required to attribute an install',
      );

    /**
     * Device integrity is *asserted* by the SDK, never observed by us, so it is graded rather
     * than trusted uniformly:
     *
     *   emulator  blocks — the shape of every install farm, and cheap to act on.
     *   rooted    recorded only; the honest population is large enough that refusing them
     *             would deny real users a real reward.
     *   vpn       recorded only, and no longer a fraud signal at all — nothing about the
     *             network is compared any more. Kept because publishers already send it, and
     *             because it costs one boolean to keep an integration from breaking.
     *
     * All three are stored on accepted installs too: the pattern worth finding is the one that
     * got paid.
     */
    const risk = {
      emulator: b.emulator === true,
      rooted: b.rooted === true,
      vpn: b.vpn === true,
    };
    if (risk.emulator) {
      recordDecision('first_open', { reason: 'device_integrity' }, { publisher_org_id: publisher.id });
      return { attributed: false, reason: 'device_integrity' };
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const m = await matchScan(tx, publisher.id, carried);
      if ('reason' in m) return { attributed: false, reason: m.reason, confidence: m.confidence };
      const { scan, confidence, match_method } = m;
      if (scan.status !== 'active') return { attributed: false, reason: 'campaign_not_active' };

      // Bind nothing against a campaign that cannot pay. The signup that follows would only
      // fail on budget anyway, and it would have burned the scan getting there — leaving a
      // real scanner permanently unattributable once the promoter tops the budget back up.
      if ((await lockedBalance(tx, `campaign:${scan.campaign_id}`)) < scan.guest_rate)
        return { attributed: false, reason: 'budget_exhausted' };

      // The repeat-device check that used to sit here is gone with the signals it hashed.
      // Nothing is lost that was ever sound: it could only see the probabilistic path, and one
      // install per scan — the guarantee that actually bounds a print run — is enforced below
      // by `consumed`, on a claim id that is unique per scan by construction.

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
          risk,
          expires_at,
        },
        select: { id: true },
      });

      // What *this campaign* advertises, not everything the publisher runs: the promoter
      // picked these offers out of the publisher's list, the artwork was printed off them, and
      // this is the answer the app grants from. Still a description, never an instruction.
      const granted = campaignBonuses(publisher.bonuses, 'acquisition', scan.bonus_types);

      return {
        attributed: true,
        /** present this at signup. Not a credential and not spendable — it names an install. */
        install_id: install.id,
        campaign_id: scan.campaign_id,
        campaign_name: scan.campaign_name,
        /** which carrier brought the claim id back: referrer | appclip | pasteboard */
        match_method,
        /** always 100 — every carrier names one exact scan. Kept for API compatibility. */
        confidence,
        signup_deadline: expires_at.toISOString(),
        bonuses: granted,
        bonus_label: bonusLabel(granted),
      };
    });

    // One record per first-open, refused or bound. This is the series that makes a
    // misconfigured store target visible: it produces no errors and writes no rows, so without
    // this the only symptom is a publisher quietly earning nothing.
    recordDecision(
      'first_open',
      {
        reason: outcome.attributed ? undefined : outcome.reason,
        match_method: outcome.match_method,
        confidence: outcome.confidence,
      },
      { publisher_org_id: publisher.id, campaign_id: outcome.campaign_id },
    );
    return outcome;
  }

  /**
   * Stage two: a new user finished signing up, so the fee is earned.
   *
   * Preferred shape is `{ install_id, publisher_user_ref }` — the match already happened at
   * first open and this call only turns it into money.
   *
   * The carrier fields are the legacy single-call shape, kept working for publishers already
   * integrated against it. They run the same deterministic lookup at signup time; the only
   * cost of this shape is that a signup which never happens leaves the scan claimable, where
   * the two-stage path would have bound it at first open.
   *
   * Unattributed is a normal answer, not an error: most installs are organic. 200 with
   * `attributed: false`, so a publisher's signup path never treats this as a failure.
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
      /** legacy single-call shape: which carrier produced it */
      carrier?: string;
      /**
       * The engagement path: a transaction code the promoter minted and the user scanned. Bare
       * (`Ab3x…`) or as the whole Play referrer it arrived in, whichever the SDK banked.
       *
       * Explicit, never read out of `install_referrer` implicitly, even though an engagement
       * referrer carries both: they are different payouts on different terms, and one call
       * quietly picking between them is an accounting surprise to reconcile by hand later.
       */
      code?: string;
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
    // The refusal answer, as in `first-open`: no campaign is resolved on any of them, so this
    // is the publisher's whole signup offer. Attributed answers carry the campaign's pick.
    const bonuses = bonusesFor(publisher.bonuses, 'acquisition');
    // Bounded before anything is parsed or stored: `publisher_user_ref` becomes a unique-index
    // entry, and the rest are attacker-shaped strings from another company's server.
    const publisher_user_ref = str(b.publisher_user_ref, 'publisher_user_ref', 200)!;
    const install_id = str(b.install_id, 'install_id', 36, false);

    // Wrapped back into referrer shape rather than validated separately, the same way `claim_id`
    // is in `readSignals`, so there is exactly one definition of what an issued code looks like.
    // A malformed one is a 400 and never a silent fallthrough to the acquisition path: that
    // would answer a question about a purchase with an answer about a signup.
    const rawCode = str(b.code, 'code', 1000, false);
    const code = rawCode ? codeFromReferrer(`qrm_code=${rawCode}`) ?? codeFromReferrer(rawCode) : null;
    if (rawCode && !code)
      throw new BadRequestException('code must be the transaction code issued to this purchase');
    if (code) return this.claimPurchase(publisher, code, publisher_user_ref);

    const carried = install_id ? null : readCarried(b as Record<string, unknown>);
    if (carried && !carried.claimId)
      throw new BadRequestException(
        'install_id, or install_referrer/claim_id, required to attribute a signup',
      );

    // Every refusal in this handler funnels through here, which is what makes it the one place
    // worth counting them — including the ones raised inside a transaction that then rolls back.
    const unattributed = (reason: string) => {
      recordDecision('claim', { reason }, { publisher_org_id: publisher.id });
      return { attributed: false, reason, bonuses, bonus_label: bonusLabel(bonuses) };
    };

    /**
     * The fee buys an *acquisition*, and an existing account signing in again is not one. Only
     * the publisher can know that, so it is asserted — and refused before the install is spent,
     * or a returning user would burn an install that is then unclaimable for no reason.
     *
     * The UNIQUE on (campaign, publisher_user_ref) catches the same ref twice; this catches
     * what that constraint cannot see — a returning user handed a fresh ref.
     */
    if (b.is_new_user === false) return unattributed('not_a_new_user');

    // Set when the UNIQUE below fires, so the replay can be answered after the transaction
    // has rolled back — inside an aborted Postgres transaction no further query can run.
    let replayCampaignId: string | null = null;

    const fresh = await prisma.$transaction(async (tx) => {
      const resolved = install_id
        ? await claimInstall(tx, publisher.id, install_id)
        : await claimAtSignup(tx, publisher.id, carried!);
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
      const { net, cut } = await payout(
        tx, scan.campaign_id, publisher.id, fee, scan.platform_fee_bps, ref,
      );

      // The fee is the number worth being able to sum from logs alone when the ledger is the
      // thing under question.
      recordDecision(
        'claim',
        { match_method, confidence },
        {
          publisher_org_id: publisher.id,
          campaign_id: scan.campaign_id,
          attribution_id: red.id,
          fee,
          platform_fee: cut,
          identified,
        },
      );

      // The campaign's own pick, as at `first-open`: what this poster promised, resolved live
      // against the publisher's current list.
      const granted = campaignBonuses(publisher.bonuses, 'acquisition', scan.bonus_types);

      return {
        attributed: true,
        attribution_id: red.id,
        campaign_id: scan.campaign_id,
        campaign_name: scan.campaign_name,
        match_method,
        confidence,
        identified,
        /** gross marketing fee, in platform credits — what the campaign budget spent. */
        fee,
        /** what actually landed in the publisher's account: fee minus the platform's cut */
        publisher_net: net,
        platform_fee: cut,
        pending_fee: identified ? 0 : scan.coin_rate - scan.guest_rate,
        confirm_deadline: identified
          ? null
          : new Date(Date.now() + scan.grace_days * 86_400_000).toISOString(),
        /**
         * The offers this campaign advertises, echoed back for their logs. A description of
         * what the publisher grants, never an instruction from this platform.
         */
        bonuses: granted,
        bonus_label: bonusLabel(granted),
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
     * Replay. This user was already attributed for this campaign, which in practice means the
     * first call succeeded and its *response* was lost — a timeout, a retried job, an
     * at-least-once queue. A 409 would make a correctly-recorded attribution look like a
     * failure to reconcile by hand, so the original answer is replayed verbatim. The UNIQUE
     * constraint, not this handler, is what guarantees the fee was paid once.
     */
    const prior = await prisma.redemption.findFirst({
      // `kind` is not decoration here. The unique index that just fired is PARTIAL —
      // `WHERE kind = 'acquisition'` — so without the same predicate in this WHERE, Postgres
      // cannot prove the index applies and reads `redemptions` sequentially on every replay.
      // It is also the correctness half: a traveller who was both a new user and a repeat
      // purchase on one campaign has two rows under this (campaign, user_ref) pair, and an
      // unscoped findFirst can hand back the engagement one — a different fee, a different
      // attribution id, and a /confirm that then answers `already_full`.
      where: { campaign_id: replayCampaignId!, publisher_user_ref, kind: 'acquisition' },
      include: { campaign: { select: { name: true, bonus_types: true, partnership: { select: { coin_rate: true, grace_days: true, platform_fee_bps: true } } } } },
    });
    // Gone only if the campaign was deleted between the two calls; nothing left to replay.
    if (!prior) throw new ConflictException('duplicate_user');
    const { coin_rate, grace_days, platform_fee_bps } = prior.campaign.partnership;
    const split = splitFee(prior.coins, platform_fee_bps);
    // Replayed answers carry the campaign's offers too — the same answer, not a different one.
    const granted = campaignBonuses(publisher.bonuses, 'acquisition', prior.campaign.bonus_types);
    // Counted separately from a fresh attribution: a replay moved no money, and a publisher
    // whose replay rate is climbing is one whose retry logic is firing, which is worth seeing.
    recordDecision(
      'claim',
      { reason: 'replay', match_method: prior.match_method, confidence: prior.confidence },
      { publisher_org_id: publisher.id, campaign_id: prior.campaign_id, attribution_id: prior.id },
    );
    return {
      attributed: true,
      attribution_id: prior.id,
      campaign_id: prior.campaign_id,
      campaign_name: prior.campaign.name,
      match_method: prior.match_method,
      confidence: prior.confidence,
      identified: prior.identified,
      fee: prior.coins,
      publisher_net: split.net,
      platform_fee: split.cut,
      pending_fee: prior.identified ? 0 : coin_rate - prior.coins,
      confirm_deadline: prior.identified
        ? null
        : new Date(prior.created_at.getTime() + grace_days * 86_400_000).toISOString(),
      bonuses: granted,
      bonus_label: bonusLabel(granted),
      replay: true,
    };
  }

  /**
   * The engagement payout: a repeat purchase, paid on the code that proves it happened.
   *
   * Deliberately not routed through the acquisition machinery above. All of that is about
   * *recognising a device* — an install stage, a carried claim, two windows, a dedupe
   * check — and none of it has a question to answer here: the code was minted against one named
   * transaction and scanned once.
   *
   * What it does share is the shape that matters: the same budget lock, the same double-entry
   * ledger, the same rollback-on-refusal, the same "a retry replays, it never re-pays".
   *
   * There is no guest tier. `identified` splits an acquisition fee because a new account is
   * worth less until somebody vouches for it; a repeat customer already transacted with the
   * promoter, which is a harder fact than any verification the publisher could apply.
   */
  private async claimPurchase(
    publisher: { id: string; bonuses: unknown },
    code: string,
    publisher_user_ref: string,
  ) {
    // Refusals only; every attributed answer below carries the campaign's own pick instead.
    const bonuses = bonusesFor(publisher.bonuses, 'engagement');
    const unattributed = (reason: string) => {
      recordDecision('claim', { reason, match_method: 'code' }, { publisher_org_id: publisher.id });
      return { attributed: false, reason, bonuses, bonus_label: bonusLabel(bonuses) };
    };

    // Set when the UNIQUE fires, so the replay can be answered after the transaction has rolled
    // back — inside an aborted Postgres transaction no further query can run.
    let replayQrCodeId: string | null = null;

    const fresh = await prisma
      .$transaction(async (tx) => {
        const m = await claimCode(tx, publisher.id, code);
        if ('reason' in m) return unattributed(m.reason);

        const fee = m.engagement_rate;
        // Fail closed, and thrown rather than returned so the whole transaction is undone —
        // the code stays claimable once the promoter tops the budget back up. A traveller
        // holding a boarding pass nobody funded should not have it burned on the way past.
        if ((await lockedBalance(tx, `campaign:${m.campaign_id}`)) < fee)
          throw new Rollback('budget_exhausted');

        let red;
        try {
          red = await tx.redemption.create({
            data: {
              campaign_id: m.campaign_id,
              scan_id: m.scan_id,
              qr_code_id: m.qr_code_id,
              publisher_user_ref,
              coins: fee,
              kind: 'engagement',
              // Nothing is held back, so the row is settled the moment it is written and
              // `/confirm` has nothing to release. See the refusal there.
              identified: true,
              match_method: 'code',
              confidence: 100,
            },
            select: { id: true },
          });
        } catch (e: any) {
          // UNIQUE (qr_code_id) WHERE kind = 'engagement': this code has already been rewarded.
          if (e.code === 'P2002') {
            replayQrCodeId = m.qr_code_id;
            throw new ConflictException('already_claimed');
          }
          throw e;
        }

        const ref = `redemption:${red.id}`;
        const { net, cut } = await payout(
          tx, m.campaign_id, publisher.id, fee, m.platform_fee_bps, ref,
        );

        recordDecision(
          'claim',
          { match_method: 'code', confidence: 100 },
          {
            publisher_org_id: publisher.id,
            campaign_id: m.campaign_id,
            attribution_id: red.id,
            fee,
            platform_fee: cut,
            kind: 'engagement',
          },
        );

        // The campaign's pick, scoped to a repeat purchase — what its codes were printed on.
        const granted = campaignBonuses(publisher.bonuses, 'engagement', m.bonus_types);

        return {
          attributed: true,
          attribution_id: red.id,
          campaign_id: m.campaign_id,
          campaign_name: m.campaign_name,
          /** `engagement` — a repeat purchase, not a signup. The two are priced separately. */
          kind: 'engagement',
          match_method: 'code',
          confidence: 100,
          identified: true,
          /** gross marketing fee, in platform credits — what the campaign budget spent. */
          fee,
          /** what actually landed in the publisher's account: fee minus the platform's cut */
          publisher_net: net,
          platform_fee: cut,
          /** always 0 and always null: an engagement payout settles in one step. */
          pending_fee: 0,
          confirm_deadline: null,
          /** the offers this campaign advertises, echoed back. Never an instruction. */
          bonuses: granted,
          bonus_label: bonusLabel(granted),
          replay: false,
        };
      })
      .catch((e) => {
        if (e instanceof Rollback) return unattributed(e.reason);
        if (replayQrCodeId) return null; // handled below, as a replay rather than an error
        throw e;
      });
    if (fresh) return fresh;

    const prior = await prisma.redemption.findFirst({
      where: { qr_code_id: replayQrCodeId!, kind: 'engagement' },
      include: { campaign: { select: { name: true, bonus_types: true, partnership: { select: { platform_fee_bps: true } } } } },
    });
    if (!prior) throw new ConflictException('already_claimed');
    const priorSplit = splitFee(prior.coins, prior.campaign.partnership.platform_fee_bps);
    const granted = campaignBonuses(publisher.bonuses, 'engagement', prior.campaign.bonus_types);

    /**
     * Two very different situations reach this line, and they must not get the same answer.
     *
     * Same user  the first call succeeded and its response was lost. Replaying the original
     *            answer stops a recorded reward looking like something to reconcile by hand.
     *
     * Different  somebody else's boarding pass — forwarded, shared, or a bug in the publisher's
     *   user     plumbing. Replaying would hand the second user a reward the first earned. One
     *            reward per code was the guarantee; this is it being kept.
     */
    if (prior.publisher_user_ref !== publisher_user_ref) return unattributed('already_claimed');

    recordDecision(
      'claim',
      { reason: 'replay', match_method: 'code', confidence: 100 },
      { publisher_org_id: publisher.id, campaign_id: prior.campaign_id, attribution_id: prior.id },
    );
    return {
      attributed: true,
      attribution_id: prior.id,
      campaign_id: prior.campaign_id,
      campaign_name: prior.campaign.name,
      kind: 'engagement',
      match_method: prior.match_method,
      confidence: prior.confidence,
      identified: true,
      fee: prior.coins,
      publisher_net: priorSplit.net,
      platform_fee: priorSplit.cut,
      pending_fee: 0,
      confirm_deadline: null,
      bonuses: granted,
      bonus_label: bonusLabel(granted),
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
          platform_fee_bps: number;
          partnership_status: string;
        }[]
      >`
        SELECT rd.id, rd.coins, rd.identified, rd.created_at, rd.campaign_id,
               p.coin_rate, p.grace_days, p.platform_fee_bps, p.status AS partnership_status
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
        // Same split as the original guest payment, so the platform's cut is taken on the
        // whole coin_rate however the fee arrived — in one piece or in two.
        await payout(tx, red.campaign_id, publisher.id, delta, red.platform_fee_bps, `upgrade:${red.id}`);
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

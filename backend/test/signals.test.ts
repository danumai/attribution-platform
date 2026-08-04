// Self-check for the scan signal extraction: geo headers, language, referer and UA parsing.
// No DB dependency — every input is a header bag.
// Run: npm run test:unit --workspace backend
import { strict as assert } from 'assert';
import { Request } from 'express';
import { scanSignals } from '../src/common/signals';

const req = (headers: Record<string, string>) => ({ headers }) as unknown as Request;

// ---------- geo ----------
assert.equal(scanSignals(req({ 'cf-ipcountry': 'bd' })).country, 'BD', 'lowercase must normalise');
assert.equal(scanSignals(req({ 'x-vercel-ip-country': 'US' })).country, 'US');
// CF's two sentinels mean "no answer" — storing them invents a country called XX.
assert.equal(scanSignals(req({ 'cf-ipcountry': 'XX' })).country, null);
assert.equal(scanSignals(req({ 'cf-ipcountry': 'T1' })).country, null);
assert.equal(scanSignals(req({ 'cf-ipcountry': 'BANGLADESH' })).country, null);
assert.equal(scanSignals(req({})).country, null, 'no CDN in front means no country, not a guess');

assert.equal(scanSignals(req({ 'x-vercel-ip-city': 'S%C3%A3o%20Paulo' })).city, 'São Paulo');
// A malformed escape must not throw away the whole scan record.
assert.equal(scanSignals(req({ 'x-vercel-ip-city': 'Dhaka%' })).city, 'Dhaka%');
assert.equal(scanSignals(req({})).city, null);

// ---------- language ----------
assert.equal(scanSignals(req({ 'accept-language': 'en-US,en;q=0.9,bn;q=0.8' })).language, 'en-us');
assert.equal(scanSignals(req({ 'accept-language': 'bn' })).language, 'bn');
assert.equal(scanSignals(req({ 'accept-language': '*' })).language, null);
assert.equal(scanSignals(req({})).language, null);

// ---------- referer ----------
// Host only: the path would drag someone else's page state into our database for no gain.
assert.equal(
  scanSignals(req({ referer: 'https://blog.example.com/posts/1?token=secret' })).referer_host,
  'blog.example.com',
);
assert.equal(scanSignals(req({ referer: 'not a url' })).referer_host, null);
// A camera scan sends no Referer at all — that absence is itself the signal.
assert.equal(scanSignals(req({})).referer_host, null);

// ---------- user agent ----------
const ua = (s: string, extra: Record<string, string> = {}) =>
  scanSignals(req({ 'user-agent': s, ...extra }));

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36';

assert.deepEqual(
  { os: ua(IPHONE).os, browser: ua(IPHONE).browser, device_type: ua(IPHONE).device_type },
  { os: 'iOS', browser: 'Safari', device_type: 'mobile' },
);
assert.deepEqual(
  { os: ua(ANDROID).os, browser: ua(ANDROID).browser, device_type: ua(ANDROID).device_type },
  { os: 'Android', browser: 'Chrome', device_type: 'mobile' },
);

// The whole point of the ordered table: every one of these also says "Chrome" or "Safari",
// and a naive includes() check would report all four as the same browser.
assert.equal(ua(`${ANDROID} Instagram 300.0.0.0`).browser, 'Instagram');
assert.equal(ua(`${IPHONE} [FBAN/FBIOS;FBAV/440.0]`).browser, 'Facebook');
assert.equal(ua(`${ANDROID} musical_ly_32.5.3 BytedanceWebview/d8a21c`).browser, 'TikTok');
assert.equal(ua(`${ANDROID} EdgA/119.0.0.0`).browser, 'Edge');
assert.equal(ua('Mozilla/5.0 (Linux; Android 13) SamsungBrowser/23.0 Chrome/115 Mobile Safari/537.36').browser, 'Samsung Internet');
assert.equal(ua('Mozilla/5.0 (iPhone) FxiOS/119.0 Mobile/15E148 Safari/605.1.15').browser, 'Firefox');

// Tablets: iPad by name, Android by the *absence* of "Mobile".
assert.equal(ua('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1').device_type, 'tablet');
assert.equal(ua('Mozilla/5.0 (Linux; Android 13; SM-X200) Chrome/119 Safari/537.36').device_type, 'tablet');
assert.equal(ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/119.0.0.0 Safari/537.36').device_type, 'desktop');

// Client hints outrank the UA string — Chrome freezes the UA, so this is the only honest
// mobile answer on recent Android.
assert.equal(ua('Mozilla/5.0 (Linux; Android 10; K) Chrome/119', { 'sec-ch-ua-mobile': '?1' }).device_type, 'mobile');
assert.equal(
  ua('Mozilla/5.0 (Windows NT 10.0) Chrome/119', { 'sec-ch-ua-platform': '"Android"' }).os,
  'Android',
  'a platform hint must beat the frozen UA token',
);

// An empty request must produce a row, not an exception — an unparseable scan is still a scan.
const blank = scanSignals(req({}));
assert.equal(blank.os, null);
assert.equal(blank.browser, null);
assert.equal(blank.device_type, 'desktop');

console.log('signals.test.ts ok');

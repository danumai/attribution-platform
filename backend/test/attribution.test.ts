// Self-check for the attribution primitives: platform detection, store destinations, and
// the referrer round-trip. No DB dependency.
// Run: npm run test:unit --workspace backend
import { strict as assert } from 'assert';
import {
  BASE,
  DeviceSignals,
  WEIGHTS,
  claimIdFromReferrer,
  decide,
  detectPlatform,
  normCores,
  normDark,
  normLang,
  normScreen,
  normTz,
  allBonuses,
  bonusLabel,
  bonusesFor,
  score,
  storeUrl,
  validateAndroidPackage,
  validateBonuses,
  validateIosAppId,
} from '../src/common/attribution';


assert.equal(detectPlatform('Mozilla/5.0 (Linux; Android 13; SM-A536E)'), 'android');
assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'ios');
assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X) Mobile/15E148'), 'ios');
assert.equal(detectPlatform('Mozilla/5.0 (Windows NT 10.0)'), 'other');
assert.equal(detectPlatform(''), 'other');

assert.equal(validateAndroidPackage('com.dramabox.app'), 'com.dramabox.app');
for (const bad of ['nodots', 'com.evil&id=x', '1com.x', 'com..x', 'com.x/../y'])
  assert.throws(() => validateAndroidPackage(bad), `should reject ${bad}`);
assert.equal(validateAndroidPackage(''), null);

assert.equal(validateIosAppId('id123456789'), '123456789');
assert.equal(validateIosAppId(123456789), '123456789');
for (const bad of ['12345', 'abcdefgh', '1234567890123']) assert.throws(() => validateIosAppId(bad));

const targets = {
  android_package: 'com.dramabox.app',
  ios_app_id: '123456789',
  landing_url: 'https://dramabox.example/get',
};
const play = storeUrl('android', targets, 'CLAIM123')!;
assert.ok(play.startsWith('https://play.google.com/store/apps/details?id=com.dramabox.app&'));
assert.ok(play.includes('qrm_claim%3DCLAIM123'), 'claim id must be inside the encoded referrer');
assert.equal(storeUrl('ios', targets, 'CLAIM123'), 'https://apps.apple.com/app/id123456789');
assert.equal(storeUrl('other', targets, 'CLAIM123'), 'https://dramabox.example/get');
assert.equal(
  storeUrl('android', { android_package: null, ios_app_id: null, landing_url: null }, 'C'),
  null,
);

// round-trip: what Play hands the app is what we can match on
const referrer = decodeURIComponent(play.split('&referrer=')[1]);
assert.equal(claimIdFromReferrer(referrer), 'CLAIM123');
assert.equal(claimIdFromReferrer('utm_source=organic'), null);
assert.equal(claimIdFromReferrer(null), null);
assert.equal(claimIdFromReferrer('qrm_claim=abc/../x'), null);

// ---------- device signals ----------
// The whole value of these is that a mobile browser and a native SDK produce the same string,
// so normalisation is the feature, not tidying.
assert.equal(normTz('Asia/Dhaka'), 'Asia/Dhaka');
assert.equal(normTz('  Europe/London '), 'Europe/London');
for (const bad of ['Asia/Dhaka; DROP', "'", 'x'.repeat(65), 42, null]) assert.equal(normTz(bad), null);

// orientation-normalised: the same handset held either way must hash to one value
assert.equal(normScreen('393x852@3'), '393x852@3');
assert.equal(normScreen('852x393@3'), '393x852@3', 'landscape must normalise to portrait');
assert.equal(normScreen('393x852@3.0'), '393x852@3', 'trailing .0 is the same ratio');
assert.equal(normScreen('390x844@2.5'), '390x844@2.5');
for (const bad of ['393x852', '393*852@3', '1x2@3', 'a x b @ c', '']) assert.equal(normScreen(bad), null);

assert.equal(normLang('en-US'), 'en-us');
assert.equal(normLang('en-US,en;q=0.9,bn;q=0.8'), 'en-us', 'Accept-Language header form');
assert.equal(normLang('bn'), 'bn');
for (const bad of ['', 'english-language-tag-far-too-long', '!!']) assert.equal(normLang(bad), null);

// Core count crosses as an integer or not at all — a float or an out-of-range claim is a
// caller widening a fingerprint dimension, not a device.
assert.equal(normCores(6), 6);
assert.equal(normCores(' 8 '), 8, 'query strings arrive as text');
for (const bad of [0, 513, 4.5, 'many', '', null, NaN]) assert.equal(normCores(bad), null);

// Appearance is a bit, and `false` is an answer — a truthiness test here would silently drop
// every light-mode device and score it as "withheld".
assert.equal(normDark(true), true);
assert.equal(normDark('1'), true);
assert.equal(normDark('dark'), true);
assert.equal(normDark(false), false);
assert.equal(normDark('0'), false);
assert.equal(normDark('light'), false);
for (const bad of ['maybe', '', null, undefined, 2]) assert.equal(normDark(bad), null);

// ---------- the decision that spends money ----------
const OPEN: DeviceSignals = {
  tz: 'Asia/Dhaka',
  screen: '393x852@3',
  language: 'en-us',
  cores: 8,
  dark: true,
};
const MIN = 70; // the shipped MIN_CONFIDENCE default

// A scan with nothing but IP + platform behind it scores the base and is refused. This is the
// case the whole scoring change exists for: an IP is a postcode, not an identity.
const bare: DeviceSignals = { tz: null, screen: null, language: null, cores: null, dark: null };
assert.equal(score(bare, OPEN), BASE);
assert.ok(BASE < MIN, 'IP + platform alone must never clear the floor on its own');
let d = decide([bare], OPEN, MIN);
assert.ok('reason' in d && d.reason === 'low_confidence', 'bare fingerprint must be refused');
assert.equal('confidence' in d ? d.confidence : null, BASE, 'the refusal still reports its score');

// Every signal agreeing is as good as a probabilistic match gets, and it tops out at exactly
// 100 — the scale the console prints as a percentage and MIN_CONFIDENCE is compared against.
assert.equal(score(OPEN, OPEN), 100);
assert.equal(BASE + Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);

// `dark: false` is a fact the device reported, not a missing signal. Scoring it as absence
// would throw away the one bit that most often splits two candidates on the same NAT.
const light = { ...bare, dark: false };
assert.equal(score(light, { ...OPEN, dark: false }), BASE + WEIGHTS.dark, 'false must score');
assert.equal(score(light, OPEN), BASE, 'light against dark is a disagreement, not a match');

// Partial agreement, and the ordering the weights are meant to produce: screen alone (the only
// signal with real entropy) must outweigh timezone and locale together.
assert.ok(
  score({ ...bare, screen: OPEN.screen }, OPEN) > score({ ...bare, tz: OPEN.tz, language: OPEN.language }, OPEN),
  'screen must dominate — a country shares a timezone and a language, not a handset',
);

// A signal the scan never captured cannot earn credit, and neither can one that disagrees.
assert.equal(score({ ...bare, tz: 'Europe/London' }, OPEN), BASE, 'a wrong signal scores nothing');
assert.equal(score(OPEN, { ...bare }), BASE, 'a signal the device withheld scores nothing');

// The single best candidate wins outright.
const strong: DeviceSignals = { ...OPEN };
const weak: DeviceSignals = { ...bare, tz: 'Asia/Dhaka' };
d = decide([weak, strong], OPEN, MIN);
assert.ok(!('reason' in d) && d.scan === strong && d.confidence === 100);

// Two candidates fitting equally well is the NAT case: refuse rather than pay the newest one.
d = decide([{ ...strong }, { ...strong }], OPEN, MIN);
assert.ok('reason' in d && d.reason === 'ambiguous', 'a tie must never be broken by recency');

// A tie among weak candidates is reported as ambiguous rather than low-confidence — the reason
// nobody was paid is that we could not tell them apart, and the fraud review needs to know it.
d = decide([{ ...bare }, { ...bare }], OPEN, MIN);
assert.ok('reason' in d && d.reason === 'ambiguous');

assert.ok('reason' in decide([], OPEN, MIN) && (decide([], OPEN, MIN) as any).reason === 'no_match');


// ---------- the publisher's own offers ----------
// Everything here is the publisher describing what *it* grants; nothing on this side ever
// fulfils one. So the checks are about shape and scope, never about the kinds themselves.
const offers = validateBonuses([
  { type: ' Coins ', label: '100 free coins', value: '100', unit: 'coins' },
  { type: 'subscription', label: '7 days of premium', value: 7, unit: 'days', on: 'engagement' },
]);
assert.deepEqual(offers[0], {
  type: 'coins',
  label: '100 free coins',
  on: 'both',
  value: 100,
  unit: 'coins',
});
assert.equal(offers[1].on, 'engagement');

assert.deepEqual(validateBonuses(undefined), []);
assert.throws(() => validateBonuses({}), /must be an array/);
assert.throws(() => validateBonuses([{ type: 'free coins', label: 'x' }]), /slug/);
assert.throws(() => validateBonuses([{ label: 'no kind' }]), /type is required/);
assert.throws(() => validateBonuses([{ type: 'coins', label: 'x', on: 'signup' }]), /on must be/);
assert.throws(() => validateBonuses(new Array(21).fill({ type: 'c', label: 'x' })), /20 entries/);

// The scoping that makes a list worth having: a signup answer must not advertise the offer
// that is only earned by coming back and buying again.
assert.deepEqual(bonusesFor(offers, 'acquisition').map((b) => b.type), ['coins']);
assert.deepEqual(bonusesFor(offers, 'engagement').map((b) => b.type), ['coins', 'subscription']);
// A row written before this shape existed degrades to "no offers" rather than throwing inside
// a payout response.
assert.deepEqual(bonusesFor('100 free coins', 'acquisition'), []);

assert.equal(bonusLabel(bonusesFor(offers, 'engagement')), '100 free coins + 7 days of premium');
assert.equal(bonusLabel([]), null);

// What the promoter console reads: every offer, unscoped, and the same degrade-to-none on junk.
assert.deepEqual(allBonuses(offers).map((b) => b.type), ['coins', 'subscription']);
assert.deepEqual(allBonuses('100 free coins'), []);
assert.deepEqual(allBonuses([null, 'x', ['y']]), []);

console.log('  ✓ attribution self-check passed');

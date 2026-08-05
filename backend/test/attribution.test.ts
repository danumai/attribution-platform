// Self-check for the attribution primitives: platform detection, store destinations, and
// the referrer round-trip. No DB dependency.
// Run: npm run test:unit --workspace backend
import { strict as assert } from 'assert';
import {
  BASE,
  DeviceSignals,
  claimIdFromReferrer,
  decide,
  detectPlatform,
  normLang,
  normScreen,
  normTz,
  score,
  storeUrl,
  validateAndroidPackage,
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

// ---------- the decision that spends money ----------
const OPEN: DeviceSignals = { tz: 'Asia/Dhaka', screen: '393x852@3', language: 'en-us' };
const MIN = 70; // the shipped MIN_CONFIDENCE default

// A scan with nothing but IP + platform behind it scores the base and is refused. This is the
// case the whole scoring change exists for: an IP is a postcode, not an identity.
const bare: DeviceSignals = { tz: null, screen: null, language: null };
assert.equal(score(bare, OPEN), BASE);
assert.ok(BASE < MIN, 'IP + platform alone must never clear the floor on its own');
let d = decide([bare], OPEN, MIN);
assert.ok('reason' in d && d.reason === 'low_confidence', 'bare fingerprint must be refused');
assert.equal('confidence' in d ? d.confidence : null, BASE, 'the refusal still reports its score');

// Every signal agreeing is as good as a probabilistic match gets.
assert.equal(score(OPEN, OPEN), 100);

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
const strong = { tz: 'Asia/Dhaka', screen: '393x852@3', language: 'en-us' };
const weak = { tz: 'Asia/Dhaka', screen: null, language: null };
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

console.log('  ✓ attribution self-check passed');

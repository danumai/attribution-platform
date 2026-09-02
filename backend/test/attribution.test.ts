// Self-check for the attribution primitives: platform detection, store destinations, and
// the referrer round-trip. No DB dependency.
// Run: npm run test:unit --workspace backend
import { strict as assert } from 'assert';
import {
  aasa,
  allBonuses,
  bonusLabel,
  bonusesFor,
  campaignBonuses,
  campaignToken,
  claimIdFromReferrer,
  detectPlatform,
  scanUrl,
  storeUrl,
  validateAndroidPackage,
  validateAppClipId,
  validateBonuses,
  validateBonusTypes,
  validateIosAppId,
  validateProviderToken,
  validateSlug,
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
assert.equal(
  storeUrl('ios', targets, 'CLAIM123'),
  'https://apps.apple.com/app/id123456789',
  'no provider token means a bare listing URL — nothing is appended the app could read',
);

// The App Store campaign link. Aggregate-only by construction: `ct` is keyed on the campaign,
// so every scan of one poster run reports into one bucket and no per-user join is possible.
const withPt = storeUrl('ios', { ...targets, ios_provider_token: '99887766', campaign_token: campaignToken('3f2a1b0c-dead-4beef-8000-000000000001') }, 'CLAIM123')!;
assert.ok(withPt.includes('pt=99887766'));
assert.ok(withPt.includes('mt=8'));
assert.ok(!withPt.includes('CLAIM123'), 'a claim id must never reach an App Store campaign link');
// Apple caps `ct` at 40 characters and rejects ? ! and & inside it.
const ct = new URL(withPt).searchParams.get('ct')!;
assert.ok(ct.length <= 40 && /^[A-Za-z0-9-]+$/.test(ct), `ct must be short and plain: ${ct}`);
assert.equal(campaignToken('abc-def'), campaignToken('abc-def'), 'stable for one campaign');
assert.notEqual(campaignToken('campaign-one'), campaignToken('campaign-two'));

// A provider token with no campaign token is a half-configured link, so it degrades to the
// bare listing rather than emitting `ct=undefined`.
assert.equal(
  storeUrl('ios', { ...targets, ios_provider_token: '99887766' }, 'CLAIM123'),
  'https://apps.apple.com/app/id123456789',
);
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

// ---------- the iOS carriers ----------
// The claim id is the only thing that travels, and these are the two things that must be true
// of every route it travels by: it names one scan, and it is never derived from the device.

assert.equal(validateAppClipId('ABCDE12345.com.example.app.Clip'), 'ABCDE12345.com.example.app.Clip');
assert.equal(validateAppClipId(''), null);
assert.equal(validateAppClipId(undefined), null);
for (const bad of [
  'com.example.app.Clip',            // no team id
  'abcde12345.com.example.app.Clip', // team ids are upper-case
  'ABCDE12345',                      // no bundle id
  'ABCDE12345.com.example app',      // a space would break the JSON document
  'ABCDE12345.com.example","evil":"', // and this is why the shape is anchored
])
  assert.throws(() => validateAppClipId(bad), `should reject ${bad}`);

assert.equal(validateProviderToken('123456'), '123456');
assert.equal(validateProviderToken(123456), '123456');
for (const bad of ['12', 'abc', '1234567890123456789012']) assert.throws(() => validateProviderToken(bad));

assert.equal(validateSlug('DramaBox'), 'dramabox', 'slugs are lowercased, not rejected');
assert.equal(validateSlug('drama-box-2'), 'drama-box-2');
for (const bad of ['ab', '-lead', 'trail-', 'has space', 'x'.repeat(41), 'under_score'])
  assert.throws(() => validateSlug(bad), `should reject ${bad}`);

// What a QR actually encodes. One definition, because this string gets printed: a publisher
// with an App Clip gets the invocation URL iOS recognises offline, everyone else gets `/r/`.
assert.equal(scanUrl('https://go.example', 'Ab3xYz'), 'https://go.example/r/Ab3xYz');
assert.equal(scanUrl('https://go.example', 'Ab3xYz', null), 'https://go.example/r/Ab3xYz');
assert.equal(scanUrl('https://go.example', 'Ab3xYz', 'dramabox'), 'https://go.example/c/dramabox/Ab3xYz');

// The association document. One file lists every registered clip — Apple's documentation is
// explicit that the array may hold more than one — and its shape is exactly this, no more.
assert.deepEqual(aasa(['ABCDE12345.com.a.Clip', 'FGHIJ67890.com.b.Clip']), {
  appclips: { apps: ['ABCDE12345.com.a.Clip', 'FGHIJ67890.com.b.Clip'] },
});
assert.deepEqual(aasa([]), { appclips: { apps: [] } });

// The regression this whole change exists to prevent: nothing in this module may reintroduce a
// way to describe a handset. If a future edit re-adds one, this fails before it ships.
const surface = Object.keys(require('../src/common/attribution'));
for (const gone of ['score', 'decide', 'WEIGHTS', 'BASE', 'normTz', 'normScreen', 'normCores', 'normDark'])
  assert.ok(!surface.includes(gone), `${gone} is device fingerprinting — it must not come back`);

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
// `type` is what a campaign names its reward by, so it has to identify exactly one offer.
assert.throws(
  () => validateBonuses([{ type: 'coins', label: '100' }, { type: 'coins', label: '50' }]),
  /appears twice/,
);

// The scoping that makes a list worth having: a signup answer must not advertise the offer
// that is only earned by coming back and buying again.
assert.deepEqual(bonusesFor(offers, 'acquisition').map((b) => b.type), ['coins']);
assert.deepEqual(bonusesFor(offers, 'engagement').map((b) => b.type), ['coins', 'subscription']);
// A row written before this shape existed degrades to "no offers" rather than throwing inside
// a payout response.
assert.deepEqual(bonusesFor('100 free coins', 'acquisition'), []);

assert.equal(bonusLabel(bonusesFor(offers, 'engagement')), '100 free coins + 7 days of premium');
assert.equal(bonusLabel([]), null);

// ---------- what one campaign promises ----------
// The promoter picks out of the publisher's eligible list, and only the pick is advertised.
assert.deepEqual(
  campaignBonuses(offers, 'engagement', ['subscription']).map((b) => b.label),
  ['7 days of premium'],
);
// No pick = every eligible offer: what a campaign meant before the pick existed, and the only
// honest answer for a publisher that declares nothing.
assert.deepEqual(campaignBonuses(offers, 'engagement', []).map((b) => b.type), ['coins', 'subscription']);
assert.deepEqual(campaignBonuses(offers, 'acquisition').map((b) => b.type), ['coins']);
// The mode still wins over the pick: an engagement-only offer cannot be promised to a signup,
// whatever the campaign selected.
assert.deepEqual(campaignBonuses(offers, 'acquisition', ['subscription']), []);
// An offer the publisher has since withdrawn drops out rather than being promised from a copy.
assert.deepEqual(campaignBonuses(offers, 'acquisition', ['gone']), []);

// The pick on the way in: normalised the same way `type` is, deduped, and checked against what
// that publisher actually grants — a campaign must not be created promising nothing fulfils.
const eligible = campaignBonuses(offers, 'engagement');
assert.deepEqual(validateBonusTypes([' Coins ', 'coins'], eligible), ['coins']);
assert.deepEqual(validateBonusTypes(undefined, eligible), []);
assert.throws(() => validateBonusTypes('coins', eligible), /must be an array/);
assert.throws(() => validateBonusTypes(['gone'], eligible), /grants no/);
// Scoped, not just known: the signup list cannot be handed an engagement-only offer.
assert.throws(
  () => validateBonusTypes(['subscription'], campaignBonuses(offers, 'acquisition')),
  /grants no/,
);

// What the promoter console reads: every offer, unscoped, and the same degrade-to-none on junk.
assert.deepEqual(allBonuses(offers).map((b) => b.type), ['coins', 'subscription']);
assert.deepEqual(allBonuses('100 free coins'), []);
assert.deepEqual(allBonuses([null, 'x', ['y']]), []);

console.log('  ✓ attribution self-check passed');

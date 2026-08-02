// Self-check for the attribution primitives: platform detection, store destinations, and
// the referrer round-trip. No DB dependency.
// Run: npm run test:unit --workspace backend
import { strict as assert } from 'assert';
import {
  claimIdFromReferrer,
  detectPlatform,
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

console.log('  ✓ attribution self-check passed');

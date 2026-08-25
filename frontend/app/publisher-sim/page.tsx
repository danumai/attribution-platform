'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TicketMark } from '@/lib/mark';
import { num } from '@/lib/fmt';
import {
  Coupon,
  Fields,
  Pass,
  PassStamp,
  Serial,
  Stub,
  passLede,
  passNote,
  passPage,
  passTitle,
} from '@/lib/pass';
import { alertErr, btn, card, checkLabel, checkbox, cx, field, label, muted, pillNeutral } from '@/lib/tw';

/**
 * Stands in for the publisher's app on first open — the step that used to be a web page
 * carrying a scan token in its URL.
 *
 * There is no token to read here, and that is the point: this screen receives nothing from
 * the scan. It signs the user up, then its backend asks our Partner API whether the install
 * was attributable. Any joining bonus shown is the publisher's own, granted by the publisher.
 */
function Sim() {
  /**
   * The one thing an engagement scan puts in the app's hands. It is plumbing between two
   * servers — inert without the publisher's API key — so it is read off the opening URL and
   * handed straight to the backend, never shown as something to type in or copy.
   */
  const code = useSearchParams().get('qrm_code');
  const [email, setEmail] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [referrer, setReferrer] = useState('');
  const [verified, setVerified] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setApiKey(localStorage.getItem('api_key') ?? '');
  }, []);

  async function call(body: any) {
    setErr('');
    setBusy(true);
    try {
      const res = await fetch('/api/sim-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, ...body }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.message ?? `HTTP ${res.status}`);
      setResult(b);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const signup = (e: any) => {
    e.preventDefault();
    return call({
      code: code ?? undefined,
      install_referrer: referrer.trim(),
      publisher_user_ref: email.trim().toLowerCase(),
      // Android hands the app a referrer; without one this falls back to the fingerprint match.
      platform: referrer.trim() ? 'android' : undefined,
      identified: verified,
    });
  };

  const brand = (
    <div className="mb-6 flex items-center gap-2.25 [&_svg]:size-6 [&_svg]:shrink-0 [&_svg]:fill-ink">
      <TicketMark />
      <b className="text-sm font-[650] tracking-[-0.015em]">DramaBox</b>
      <span className={pillNeutral}>demo publisher</span>
    </div>
  );

  if (result && result.attributed === false)
    return (
      <main className={passPage}>
        <Pass>
          <Coupon>
            {brand}
            <PassStamp>ORGANIC</PassStamp>
            <h1 className={passTitle}>Account created</h1>
            <p className={passLede}>
              This install was not attributable to a campaign
              {result.reason ? ` (${result.reason})` : ''}, so no promoter was charged.
            </p>
            <p className={passNote}>
              An unattributed install is a normal answer, not an error. Most installs are organic —
              the platform only bills a promoter when it can name the campaign that earned one.
            </p>
          </Coupon>
          <Stub>
            <Fields
              items={[
                ['Attributed', 'No'],
                ['Reason', result.reason ?? 'no match'],
                ['Promoter charged', '0'],
              ]}
            />
            <Serial items={['Organic']} />
          </Stub>
        </Pass>
      </main>
    );

  if (result)
    return (
      <main className={passPage}>
        <Pass>
          <Coupon>
            {brand}
            <PassStamp posted>POSTED</PassStamp>
            <h1 className={passTitle}>
              {/* `bonus_label` is now the summary of whichever offers apply to *this* claim, so
                  the engagement case no longer needs its own wording — the API already scoped it. */}
              {result.bonus_label ??
                (result.kind === 'engagement' ? 'Purchase reward applied' : 'Joining bonus applied')}
            </h1>
            {/* What the publisher's app would actually act on. `type` is this publisher's own
                word for the kind of thing it grants — the platform stores and echoes it and
                never fulfils any of it. */}
            {result.bonuses?.length > 0 && (
              <ul className={`${muted} mt-2 space-y-0.5`}>
                {result.bonuses.map((b: any, i: number) => (
                  <li key={i}>
                    <span className={pillNeutral}>{b.type}</span> {b.label}
                    {b.value !== undefined && ` — grants ${num(b.value)}${b.unit ? ` ${b.unit}` : ''}`}
                  </li>
                ))}
              </ul>
            )}

            <p className={passLede}>
              Granted by this publisher under its own new-user policy. The platform recorded the
              install against <strong>{result.campaign_name}</strong> and charged the promoter a{' '}
              {num(result.fee)}-credit marketing fee — the user&apos;s bonus and the promoter&apos;s
              fee are separate things.
            </p>

            {result.pending_fee > 0 && (
              <div className={`${card} mt-3`}>
                <p>
                  <strong>{num(result.pending_fee)} credits</strong> of the fee are held back until
                  this publisher confirms the user cleared its verification bar.
                </p>
                <p className={muted}>
                  Holds until {new Date(result.confirm_deadline).toLocaleDateString()}.
                </p>
                <button
                  className={cx(btn, 'mt-3.5')}
                  disabled={busy}
                  onClick={() => call({ confirm_id: result.attribution_id })}
                >
                  {busy ? 'Confirming…' : 'Confirm this user is verified'}
                </button>
                {err && <div className={`${alertErr} mt-3.5`}>{err}</div>}
              </div>
            )}
          </Coupon>
          <Stub>
            <Fields
              items={[
                ['Attribution', result.attribution_id],
                ['Matched by', result.match_method],
                ['Fee charged', num(result.fee)],
                ...(result.pending_fee > 0
                  ? ([['Held back', num(result.pending_fee)]] as [string, string][])
                  : []),
              ]}
            />
            <Serial items={[result.pending_fee > 0 ? 'Part held' : 'Posted']} />
          </Stub>
        </Pass>
      </main>
    );

  return (
    <main className={passPage}>
      <Pass>
        <Coupon>
          {brand}
          <h1 className={passTitle}>{code ? 'Welcome back' : 'First open'}</h1>
          <p className={passLede}>
            {code
              ? 'This open carried a transaction code from a boarding pass. Identifying yourself lets this app ask, server-to-server, whether that purchase is rewardable.'
              : 'Nothing arrived from the scan. Signing up triggers a server-to-server attribution lookup; the app itself never handles a code.'}
          </p>
          <form onSubmit={signup}>
            <label className={label}>Your email (becomes publisher_user_ref)</label>
            <input
              className={field}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="viewer@example.com"
            />
            {!code && (
              <>
                <label className={label}>Play install referrer (Android only — leave blank to test the iOS path)</label>
                <input
                  className={field}
                  value={referrer}
                  onChange={(e) => setReferrer(e.target.value)}
                  placeholder="utm_source=qrmarketer&qrm_claim=…"
                />
              </>
            )}
            <label className={label}>Publisher API key (this demo&apos;s stand-in for server config)</label>
            <input className={field} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="pk_…" />
            {/* There is no guest tier on a repeat purchase: the customer already transacted
                with the promoter, which is harder evidence than any verification bar. */}
            {!code && (
              <label className={checkLabel}>
                <input
                  className={checkbox}
                  type="checkbox"
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                />
                User is verified (full fee) — leave unticked for the guest tier
              </label>
            )}
            <button className={cx(btn, 'mt-3.5')} type="submit" disabled={busy}>
              {busy ? 'Working…' : code ? 'Continue' : 'Create account'}
            </button>
            {err && <div className={`${alertErr} mt-3.5`}>{err}</div>}
          </form>
        </Coupon>
        <Stub>
          <Fields
            items={[
              ['Surface', 'Publisher app'],
              ['Received from scan', 'Nothing'],
              ['Tier on signup', verified ? 'Identified' : 'Guest'],
              ['Match path', referrer.trim() ? 'Referrer' : 'Fingerprint'],
            ]}
          />
          <Serial items={['Stand-in']} />
        </Stub>
      </Pass>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Sim />
    </Suspense>
  );
}

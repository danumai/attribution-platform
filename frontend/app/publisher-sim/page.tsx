'use client';
import { Suspense, useEffect, useState } from 'react';

/**
 * Stands in for the publisher's app on first open — the step that used to be a web page
 * carrying a scan token in its URL.
 *
 * There is no token to read here, and that is the point: this screen receives nothing from
 * the scan. It signs the user up, then its backend asks our Partner API whether the install
 * was attributable. Any joining bonus shown is the publisher's own, granted by the publisher.
 */
function Sim() {
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
      install_referrer: referrer.trim(),
      publisher_user_ref: email.trim().toLowerCase(),
      // Android hands the app a referrer; without one this falls back to the fingerprint match.
      platform: referrer.trim() ? 'android' : undefined,
      identified: verified,
    });
  };

  if (result && result.attributed === false)
    return (
      <main className="auth" style={{ maxWidth: 460 }}>
        <h1>Welcome</h1>
        <p className="muted">
          Account created. This install was not attributable to a campaign
          {result.reason ? ` (${result.reason})` : ''} — so it is treated as organic and the
          promoter is charged nothing.
        </p>
        <div className="card">
          <p className="muted">
            An unattributed install is a normal answer, not an error. Most installs are organic.
          </p>
        </div>
      </main>
    );

  if (result)
    return (
      <main className="auth" style={{ maxWidth: 460 }}>
        <div className="brand">✓</div>
        <h1>{result.bonus_label ?? 'Joining bonus applied'}</h1>
        <p className="muted">
          Granted by this publisher under its own new-user policy. The platform recorded the
          install against <strong>{result.campaign_name}</strong> and charged the promoter a{' '}
          {result.fee}-credit marketing fee — the user&apos;s bonus and the promoter&apos;s fee
          are separate things.
        </p>
        {result.pending_fee > 0 && (
          <div className="card">
            <p>
              <strong>{result.pending_fee} credits</strong> of the fee are held back until this
              publisher confirms the user cleared its verification bar.
            </p>
            <p className="muted">
              Holds until {new Date(result.confirm_deadline).toLocaleDateString()}.
            </p>
            <button disabled={busy} onClick={() => call({ confirm_id: result.attribution_id })}>
              {busy ? 'Confirming…' : 'Confirm this user is verified'}
            </button>
            {err && <div className="err">{err}</div>}
          </div>
        )}
        <div className="card">
          <p className="muted">
            Attribution {result.attribution_id} · matched by {result.match_method}
          </p>
        </div>
      </main>
    );

  return (
    <main style={{ maxWidth: 460 }}>
      <h1>DramaBox</h1>
      <p className="muted">Publisher app — first open (demo)</p>
      <p className="muted">
        Nothing arrived from the scan. Signing up triggers a server-to-server attribution
        lookup; the app itself never handles a code.
      </p>
      <form className="card" onSubmit={signup}>
        <label>Your email (becomes publisher_user_ref)</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="viewer@example.com"
        />
        <label>Play install referrer (Android only — leave blank to test the iOS path)</label>
        <input
          value={referrer}
          onChange={(e) => setReferrer(e.target.value)}
          placeholder="utm_source=qrmarketer&qrm_claim=…"
        />
        <label>Publisher API key (this demo&apos;s stand-in for server config)</label>
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="pk_…" />
        <label>
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />{' '}
          User is verified (full fee) — leave unticked for the guest tier
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
        {err && <div className="err">{err}</div>}
      </form>
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

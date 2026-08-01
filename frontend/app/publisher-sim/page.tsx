'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function Sim() {
  const sp = useSearchParams();
  const scanToken = sp.get('st') ?? '';
  const [email, setEmail] = useState('');
  const [apiKey, setApiKey] = useState('');
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
      scan_token: scanToken,
      publisher_user_ref: email.trim().toLowerCase(),
      identified: verified,
    });
  };

  // Reward first, identification second — the guest keeps what they earned and is nudged,
  // not gated, toward unlocking the rest.
  if (result)
    return (
      <main style={{ maxWidth: 460, textAlign: 'center', paddingTop: 60 }}>
        <h1>🎉 {result.coins} coins added</h1>
        <p className="muted">
          Welcome to the app. Your coins are ready to unlock premium episodes.
        </p>
        {result.pending_coins > 0 && (
          <div className="card">
            <p>
              <strong>{result.pending_coins} more coins</strong> are waiting — verify your
              account to release them.
            </p>
            <p className="muted">
              Offer holds until {new Date(result.upgrade_deadline).toLocaleDateString()}.
            </p>
            <button disabled={busy} onClick={() => call({ upgrade_id: result.redemption_id })}>
              {busy ? 'Verifying…' : 'Verify my account'}
            </button>
            {err && <div className="err">{err}</div>}
          </div>
        )}
        <div className="card">
          <p className="muted">Redemption {result.redemption_id}</p>
        </div>
      </main>
    );

  return (
    <main style={{ maxWidth: 460 }}>
      <h1>DramaBox (publisher demo)</h1>
      <p className="muted">
        {scanToken
          ? 'You scanned a partner QR — create an account to claim your coins.'
          : 'No scan token present. Scan a campaign QR code to arrive here with a reward.'}
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
        <label>Publisher API key (this demo's stand-in for server config)</label>
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="pk_…" />
        <label>
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />{' '}
          Account is verified (full reward) — leave unticked to claim the guest tier
        </label>
        <button type="submit" disabled={busy || !scanToken}>
          {busy ? 'Creating account…' : 'Create account & claim coins'}
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

'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Stands in for the publisher's app on first open. There is no token to read here — the claim id
 * travels in the carrier, and nothing reaching the phone is spendable.
 */
export function useSim() {
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
      // Android hands the app a referrer. Without one there is nothing to match on and the
      // answer is `no_match` — which is the honest outcome for an install nobody can trace.
      carrier: referrer.trim() ? 'referrer' : undefined,
      identified: verified,
    });
  };

  const confirm = () => call({ confirm_id: result?.attribution_id });

  return {
    code,
    email,
    setEmail,
    apiKey,
    setApiKey,
    referrer,
    setReferrer,
    verified,
    setVerified,
    result,
    err,
    busy,
    signup,
    confirm,
  };
}

'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { AuthResult } from '@/lib/types';
import {
  Brand,
  Coupon,
  Fields,
  Pass,
  Perf,
  Serial,
  Stub,
  passLede,
  passPage,
  passTitle,
} from '@/lib/pass';
import {
  alertErr,
  btn,
  codeKey,
  cx,
  field,
  label,
  muted,
  pillOk,
  tab,
  tabs,
} from '@/lib/tw';

/** Compile-time, so the demo credentials are dropped from the production bundle entirely. */
const DEMO = process.env.NODE_ENV !== 'production';

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const r = useRouter();
  // the landing page's CTAs arrive as /login?mode=signup&type=promoter|publisher
  const q = useSearchParams();
  const [mode, setMode] = useState<'login' | 'signup'>(
    q.get('mode') === 'signup' ? 'signup' : 'login',
  );
  const [f, setF] = useState({
    name: '',
    // Seeded from .env on backend boot, so a demo signs in straight away — but `NEXT_PUBLIC_*`
    // is inlined into JS served to every anonymous visitor, so a production build must not
    // carry working credentials in its bundle. Dev only, and the check is compile-time.
    email: DEMO ? (process.env.NEXT_PUBLIC_DEMO_EMAIL ?? '') : '',
    password: DEMO ? (process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? '') : '',
    type: q.get('type') === 'publisher' ? 'publisher' : 'promoter',
    landing_url: '',
  });
  const [err, setErr] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  function switchMode(next: 'login' | 'signup') {
    setErr('');
    setMode(next);
  }

  async function submit(e: any) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const body =
        mode === 'login'
          ? { email: f.email, password: f.password }
          : {
              name: f.name,
              email: f.email,
              password: f.password,
              type: f.type,
              landing_url: f.type === 'publisher' ? f.landing_url || undefined : undefined,
            };
      const res = await api<AuthResult>(`/v1/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      localStorage.setItem('token', res.token);
      localStorage.setItem('org', JSON.stringify(res.org));
      if (res.api_key) {
        // shown once — publisher needs it for the Partner API
        localStorage.setItem('api_key', res.api_key);
        setApiKey(res.api_key);
        return;
      }
      r.push(res.org.type === 'admin' ? '/admin' : '/dashboard');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (apiKey)
    return (
      <main className={passPage}>
        <Pass single>
          <Coupon>
            <Brand />
            <span className={pillOk}>Key issued</span>
            <h1 className={passTitle}>Publisher API key</h1>
            <p className={passLede}>
              Shown once. Your backend uses this to call the Partner API — store it now.
            </p>
            <code className={codeKey}>{apiKey}</code>
            <button className={`${btn} mt-5.5 w-full py-3`} onClick={() => r.push('/dashboard')}>
              Continue to dashboard
            </button>
          </Coupon>
        </Pass>
      </main>
    );

  return (
    <main className={passPage}>
      <Pass>
        <Coupon>
          <Brand />
          <div className={tabs} role="tablist">
            <button className={tab(mode === 'login')} role="tab" type="button" aria-selected={mode === 'login'} onClick={() => switchMode('login')}>
              Sign in
            </button>
            <button className={tab(mode === 'signup')} role="tab" type="button" aria-selected={mode === 'signup'} onClick={() => switchMode('signup')}>
              Create account
            </button>
          </div>
          <h1 className={passTitle}>
            {mode === 'signup' ? 'Open a new account' : 'Welcome back'}
          </h1>
          <p className={passLede}>
            {mode === 'signup'
              ? 'Set up a promoter or publisher workspace.'
              : 'Sign in to your workspace.'}
          </p>
          <form onSubmit={submit}>
            {mode === 'signup' && (
              <>
                <label className={label}>Organization name</label>
                <input className={field} value={f.name} onChange={set('name')} placeholder="Air Dhaka" />
                <label className={label}>Account type</label>
                <div className={tabs} role="tablist">
                  <button
                    className={tab(f.type === 'promoter')}
                    role="tab"
                    type="button"
                    aria-selected={f.type === 'promoter'}
                    onClick={() => setF({ ...f, type: 'promoter' })}
                  >
                    Promoter
                  </button>
                  <button
                    className={tab(f.type === 'publisher')}
                    role="tab"
                    type="button"
                    aria-selected={f.type === 'publisher'}
                    onClick={() => setF({ ...f, type: 'publisher' })}
                  >
                    Publisher
                  </button>
                </div>
                <p className={`${muted} mt-1.5`}>
                  {f.type === 'publisher'
                    ? 'Grants coins to your subscribers, funded by promoter budgets.'
                    : 'Runs campaigns and funds coin rewards from a budget.'}
                </p>
                {f.type === 'publisher' && (
                  <>
                    <label className={label}>Landing URL (where scans redirect)</label>
                    <input
                      className={field}
                      value={f.landing_url}
                      onChange={set('landing_url')}
                      placeholder="http://localhost:3000/publisher-sim"
                    />
                  </>
                )}
              </>
            )}
            <label className={label}>Email</label>
            <input className={field} type="email" autoComplete="email" value={f.email} onChange={set('email')} />
            <label className={label}>Password</label>
            <input
              className={field}
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={f.password}
              onChange={set('password')}
            />
            <button className={cx(btn, 'mt-5.5 w-full py-3')} type="submit" disabled={busy}>
              {busy ? 'Just a moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
            {err && <div className={`${alertErr} mt-3.5`}>{err}</div>}
          </form>
        </Coupon>
        <Perf />
        <Stub>
          <Fields
            items={[
              ['Instrument', 'QR Reward Platform'],
              ['Mode', mode === 'login' ? 'Sign in' : 'New account'],
              ...(mode === 'signup'
                ? ([['Class', f.type === 'publisher' ? 'Publisher' : 'Promoter']] as [string, string][])
                : []),
            ]}
          />
          <Serial items={['Ser. 7f3a-c19e', 'Rev 01']} />
        </Stub>
      </Pass>
    </main>
  );
}

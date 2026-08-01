'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

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
    // seeded from .env on backend boot — sign in straight away
    email: process.env.NEXT_PUBLIC_DEMO_EMAIL ?? '',
    password: process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? '',
    type: q.get('type') === 'publisher' ? 'publisher' : 'promoter',
    landing_url: '',
  });
  const [err, setErr] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

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
      const res = await api(`/v1/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) });
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
      <main className="auth" style={{ maxWidth: 560 }}>
        <h1>Publisher API key</h1>
        <p className="muted">Shown once. Your backend uses this to call the Partner API.</p>
        <div className="card">
          <code className="key">{apiKey}</code>
          <button onClick={() => r.push('/dashboard')}>Continue to dashboard</button>
        </div>
      </main>
    );

  return (
    <main className="auth">
      <div className="brand">QR</div>
      <h1>QR Reward Platform</h1>
      <p className="muted">
        {mode === 'signup'
          ? 'Create a promoter or publisher account'
          : 'Sign in to your workspace'}
      </p>
      <form className="card" onSubmit={submit}>
        {mode === 'signup' && (
          <>
            <label>Organization name</label>
            <input value={f.name} onChange={set('name')} placeholder="Air Dhaka" />
            <label>Account type</label>
            <select value={f.type} onChange={set('type')}>
              <option value="promoter">Promoter (runs campaigns)</option>
              <option value="publisher">Publisher (grants coins)</option>
            </select>
            {f.type === 'publisher' && (
              <>
                <label>Landing URL (where scans redirect)</label>
                <input
                  value={f.landing_url}
                  onChange={set('landing_url')}
                  placeholder="http://localhost:3000/publisher-sim"
                />
              </>
            )}
          </>
        )}
        <label>Email</label>
        <input type="email" autoComplete="email" value={f.email} onChange={set('email')} />
        <label>Password</label>
        <input
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={f.password}
          onChange={set('password')}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Just a moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
        {err && <div className="err">{err}</div>}
      </form>
      <p className="auth-alt">
        {mode === 'login' ? 'No account yet?' : 'Already registered?'}
        <a onClick={() => { setErr(''); setMode(mode === 'login' ? 'signup' : 'login'); }}>
          {mode === 'login' ? 'Create one' : 'Sign in'}
        </a>
      </p>
    </main>
  );
}

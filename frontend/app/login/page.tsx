'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { AuthResult } from '@/lib/types';
import {
  Brand,
  Coupon,
  Pass,
  RoleCard,
  Stub,
  passLede,
  passPage,
  passTitle,
} from '@/lib/pass';
import {
  alertErr,
  btn,
  btnGhost,
  checkbox,
  checkLabel,
  codeKey,
  cx,
  field,
  hint,
  label,
  stampCaps,
  tab,
  tabs,
} from '@/lib/tw';

/** Compile-time, so the demo credentials are dropped from the production bundle entirely. */
const DEMO = process.env.NODE_ENV !== 'production';

/** The server's rule, stated before the attempt rather than after it — `auth.controller.ts`
 *  rejects anything shorter, which used to surface as a red box under an already-filled form. */
const MIN_PASSWORD = 8;

type Role = 'promoter' | 'publisher';

/** What each side of the marketplace is here to do. The side panel reads from the same source
 *  as the role cards, so the two can never describe the roles differently. */
const ROLES: Record<Role, { title: string; body: string; points: string[] }> = {
  promoter: {
    title: 'Promoter',
    body: 'You print the codes and fund the rewards.',
    points: [
      'Fund a budget — it is the most you can ever spend',
      'Design and export print-ready QR codes',
      'Pay only once a publisher confirms a real signup',
    ],
  },
  publisher: {
    title: 'Publisher',
    body: 'You bring the audience and confirm the signups.',
    points: [
      'Set where a scan lands — Play, App Store, or web',
      'Confirm signups through the Partner API',
      'Earn the agreed fee from the promoter’s budget',
    ],
  },
};

function Check() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         className="mt-0.5 size-3.5 shrink-0 text-accent-text">
      <path d="M3 8.5 6.2 11.5 13 4.5" />
    </svg>
  );
}

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
// Seeded from .env on backend boot so a demo signs in straight away — but `NEXT_PUBLIC_*` is
// inlined into JS served to every anonymous visitor.
    email: DEMO ? (process.env.NEXT_PUBLIC_DEMO_EMAIL ?? '') : '',
    password: DEMO ? (process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? '') : '',
    type: (q.get('type') === 'publisher' ? 'publisher' : 'promoter') as Role,
    landing_url: '',
  });
  const [err, setErr] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);

  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  function switchMode(next: 'login' | 'signup') {
    setErr('');
    setMode(next);
  }

  // Checked here so an incomplete form never becomes a round trip. The server still validates —
  // this is about not making the reader submit in order to find out.
  const emailOk = /.+@.+\..+/.test(f.email);
  const passwordOk = f.password.length >= MIN_PASSWORD;
  const ready =
    mode === 'login'
      ? Boolean(f.email && f.password)
      : emailOk && passwordOk && Boolean(f.name.trim());

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
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: res.token, org: res.org }),
      }).catch(() => {});
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

  if (apiKey) return <ApiKeyHandoff apiKey={apiKey} onDone={() => r.push('/dashboard')} />;

  const role = ROLES[f.type];

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
            {mode === 'signup' ? 'Create your workspace' : 'Welcome back'}
          </h1>
          <p className={passLede}>
            {mode === 'signup'
              ? 'Two kinds of account. Pick the one that describes you.'
              : 'Sign in to your workspace.'}
          </p>

          <form onSubmit={submit} noValidate>
            {mode === 'signup' && (
              <>
                {/* The fork comes first. Everything below it is the same either way, so the form
                    no longer changes shape under someone already part-way through filling it in. */}
                <div className="mt-5 grid grid-cols-2 gap-2.5 max-[440px]:grid-cols-1">
                  {(Object.keys(ROLES) as Role[]).map((k) => (
                    <RoleCard
                      key={k}
                      title={ROLES[k].title}
                      body={ROLES[k].body}
                      selected={f.type === k}
                      onSelect={() => setF({ ...f, type: k })}
                    />
                  ))}
                </div>

                <label className={label} htmlFor="org">Organization name</label>
                <input id="org" className={field} value={f.name} onChange={set('name')} placeholder="Air Dhaka" />

                {f.type === 'publisher' && (
                  <>
                    <label className={label} htmlFor="landing">
                      Landing URL{' '}
                      <span className="font-normal text-mut">— optional, you can set this later</span>
                    </label>
                    <input
                      id="landing"
                      className={field}
                      value={f.landing_url}
                      onChange={set('landing_url')}
                      placeholder="https://example.com/get-the-app"
                    />
                    <p className={hint}>Where a scan lands when there is no app for that platform.</p>
                  </>
                )}
              </>
            )}

            <label className={label} htmlFor="email">Email</label>
            <input
              id="email"
              className={field}
              type="email"
              autoComplete="email"
              value={f.email}
              onChange={set('email')}
            />
            {mode === 'signup' && f.email && !emailOk && (
              <p className={hint}>That doesn’t look like an email address yet.</p>
            )}

            <label className={label} htmlFor="password">Password</label>
            <div className="relative">
              <input
                id="password"
                className={cx(field, 'pr-16')}
                type={reveal ? 'text' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={f.password}
                onChange={set('password')}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 cursor-pointer px-3 text-[12.5px] font-medium text-mut hover:text-ink"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? 'Hide password' : 'Show password'}
              >
                {reveal ? 'Hide' : 'Show'}
              </button>
            </div>
            {mode === 'signup' && (
              <p className={cx(hint, passwordOk && f.password && 'text-ok')}>
                {passwordOk && f.password ? 'Long enough.' : `At least ${MIN_PASSWORD} characters.`}
              </p>
            )}

            <button className={cx(btn, 'mt-5.5 w-full py-3')} type="submit" disabled={busy || !ready}>
              {busy
                ? 'Just a moment…'
                : mode === 'signup'
                  ? `Create ${role.title.toLowerCase()} account`
                  : 'Sign in'}
            </button>
            {err && <div className={`${alertErr} mt-3.5`}>{err}</div>}

            {DEMO && mode === 'login' && (
              <p className={hint}>Development build — demo credentials are prefilled.</p>
            )}
          </form>
        </Coupon>

        {/* The side panel used to restate the tab that had just been clicked. It now carries the
            reason to be on this page at all, and follows the role choice beside it. */}
        <Stub>
          {mode === 'signup' ? (
            <>
              <div>
                <span className={stampCaps}>{role.title}</span>
                <p className="mt-1.5 text-[13.5px] font-medium tracking-[-0.008em] text-ink">
                  {role.body}
                </p>
              </div>
              <ul className="grid gap-2.5">
                {role.points.map((p) => (
                  <li key={p} className="flex gap-2 text-[13px] leading-normal text-ink-soft">
                    <Check />
                    {p}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div>
                <span className={stampCaps}>QR Reward Platform</span>
                <p className="mt-1.5 text-[13.5px] font-medium tracking-[-0.008em] text-ink">
                  Pay for signups, not for scans.
                </p>
              </div>
              <p className="text-[13px] leading-normal text-ink-soft">
                Coins leave a campaign budget only after a publisher confirms a real signup.
              </p>
            </>
          )}
          <p className="mt-auto border-t border-line pt-3.5 text-[12.5px]">
            <Link href="/" className="font-medium text-ink-soft no-underline hover:text-accent-text">
              ← Back to the overview
            </Link>
          </p>
        </Stub>
      </Pass>
    </main>
  );
}

/**
 * The one screen in this product whose content cannot be recovered. The server stores only a hash
 * of this key and can never print it again.
 */
function ApiKeyHandoff({ apiKey, onDone }: { apiKey: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [ack, setAck] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is permission-gated and absent over plain http. The key is on screen and
      // selectable, so the download and the visible key are the fallback.
      setCopied(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([apiKey], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'qr-reward-platform-api-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className={passPage}>
      <Pass single>
        <Coupon>
          <Brand />
          <h1 className={passTitle}>Store your API key</h1>
          <p className={passLede}>
            This is the only time it will be shown. The server keeps a hash of it and cannot print
            it again — if you lose it, you will have to rotate to a new one.
          </p>

          <code className={codeKey}>{apiKey}</code>

          <div className="mt-3.5 flex flex-wrap gap-2.5">
            <button className={btnGhost} onClick={copy} type="button">
              {copied ? 'Copied' : 'Copy key'}
            </button>
            <button className={btnGhost} onClick={download} type="button">
              Download as .txt
            </button>
          </div>

          <p className={hint}>
            Your backend sends this with <code>POST /v1/attribution/claim</code> when a scanned
            user finishes signing up.
          </p>

          <label className={checkLabel}>
            <input
              className={checkbox}
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I have stored this key somewhere safe.
          </label>

          <button className={cx(btn, 'mt-5.5 w-full py-3')} onClick={onDone} disabled={!ack}>
            Continue to dashboard
          </button>
        </Coupon>
      </Pass>
    </main>
  );
}

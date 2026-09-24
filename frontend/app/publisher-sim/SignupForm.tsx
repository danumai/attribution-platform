import { Coupon, Fields, Pass, Serial, Stub, passLede, passPage, passTitle } from '@/lib/pass';
import { alertErr, btn, checkLabel, checkbox, cx, field, label } from '@/lib/tw';
import { PublisherBrand } from './PublisherBrand';

export function SignupForm({
  code,
  email,
  setEmail,
  referrer,
  setReferrer,
  apiKey,
  setApiKey,
  verified,
  setVerified,
  busy,
  err,
  onSubmit,
}: {
  code: string | null;
  email: string;
  setEmail: (v: string) => void;
  referrer: string;
  setReferrer: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  verified: boolean;
  setVerified: (v: boolean) => void;
  busy: boolean;
  err: string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <main className={passPage}>
      <Pass>
        <Coupon>
          <PublisherBrand />
          <h1 className={passTitle}>{code ? 'Welcome back' : 'First open'}</h1>
          <p className={passLede}>
            {code
              ? 'This open carried a transaction code from a boarding pass. Identifying yourself lets this app ask, server-to-server, whether that purchase is rewardable.'
              : 'Nothing arrived from the scan. Signing up triggers a server-to-server attribution lookup; the app itself never handles a code.'}
          </p>
          <form onSubmit={onSubmit}>
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

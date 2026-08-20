'use client';
import { ChangeEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { confirmDialog } from '@/lib/ui';
import { btn, btnGhost, card, code as codeChip, codeKey, cx, field, hint, label, muted, sectionHead } from '@/lib/tw';
import type { SectionProps } from '../types';

/** Where scans are sent, per platform, plus the publisher's own declared joining bonus. */
const DESTINATIONS = [
  ['android_package', 'Google Play package (Android scans)', 'com.example.app'],
  ['ios_app_id', 'App Store id (iPhone scans)', '123456789'],
  ['landing_url', 'Web fallback (desktop scans, and platforms with no app registered)', 'https://example.com/get-the-app'],
] as const;

const EMPTY = { landing_url: '', android_package: '', ios_app_id: '', deeplink_url: '', bonus_label: '' };

export function Settings({ d, busy, act }: Pick<SectionProps, 'd' | 'busy' | 'act'>) {
  const { profile } = d;
  const [dest, setDest] = useState(EMPTY);
  // Read in an effect, never in render: this component is prerendered on the server, where
  // there is no localStorage, so reading it during render is a guaranteed hydration mismatch.
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => setApiKey(localStorage.getItem('api_key')), []);

  // Re-seeded whenever the profile is refetched, so a save that the server normalised shows
  // what the server actually stored rather than what was typed.
  useEffect(() => {
    if (!profile) return;
    setDest({
      landing_url: profile.landing_url ?? '',
      android_package: profile.android_package ?? '',
      ios_app_id: profile.ios_app_id ?? '',
      deeplink_url: profile.deeplink_url ?? '',
      bonus_label: profile.bonus_label ?? '',
    });
  }, [profile]);

  const on = (k: keyof typeof dest) => (e: ChangeEvent<HTMLInputElement>) =>
    setDest((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <>
      <h2 className={sectionHead}>Where scans go</h2>
      <div className={cx(card, 'mt-3')}>
        <p className={muted}>
          A scan is sent straight to your store listing. Nothing redeemable travels with it —
          your app receives no code, and attribution happens server-to-server afterwards.
        </p>
        {DESTINATIONS.map(([name, text, placeholder]) => (
          <div key={name}>
            <label className={label}>{text}</label>
            <input className={field} value={dest[name]} placeholder={placeholder} onChange={on(name)} />
          </div>
        ))}

        <label className={label}>App link (repeat-purchase campaigns)</label>
        <input
          className={field}
          value={dest.deeplink_url}
          placeholder="https://example.com/open"
          onChange={on('deeplink_url')}
        />
        <p className={muted}>
          An https URL you have registered as an Android App Link / iOS Universal Link. Scans on
          a repeat-purchase campaign are sent here, so the phone opens your app when it is
          installed and falls back to the store when it is not — the OS decides, not us.
        </p>

        <label className={label}>Your joining bonus, in your own words</label>
        <input
          className={field}
          value={dest.bonus_label}
          placeholder="100 free coins for new accounts"
          onChange={on('bonus_label')}
        />
        <p className={muted}>
          A label for reporting and for promoters designing artwork. You grant the bonus, on your
          own terms — this platform never issues or fulfils it.
        </p>

        <button
          className={cx(btn, 'mt-5')}
          disabled={busy}
          onClick={() =>
            act(() => api('/v1/orgs/me', { method: 'PATCH', body: JSON.stringify(dest) }), 'Destinations saved.')
          }
        >
          {busy ? 'Saving…' : 'Save destinations'}
        </button>
      </div>

      <h2 className={sectionHead}>API key</h2>
      <div className={cx(card, 'mt-3')}>
        <p className={muted}>
          Your backend calls <code className={codeChip}>POST /v1/attribution/claim</code> with this
          key when a new user finishes signing up, passing the Play install referrer (Android) or
          the first-open IP (iOS).
        </p>
        {/* The key is only ever held in this browser: the server stores a hash, so it cannot be
            shown again on another device. Say that, rather than rendering nothing and looking
            broken. */}
        {apiKey ? (
          <code className={codeKey}>{apiKey}</code>
        ) : (
          <p className={hint}>
            Your key was shown once when it was issued and is not stored here. If you no longer
            have it, rotate to issue a new one.
          </p>
        )}
        <button
          className={cx(btnGhost, 'mt-4')}
          onClick={async () => {
            const go = await confirmDialog({
              title: 'Rotate API key?',
              body: 'The current key stops working immediately. Any backend still using it will start failing until you deploy the new one.',
              confirmText: 'Rotate key',
              danger: true,
            });
            if (!go) return;
            await act(async () => {
              const res = await api<{ api_key: string }>('/v1/api-keys/rotate', { method: 'POST' });
              localStorage.setItem('api_key', res.api_key);
              setApiKey(res.api_key);
            }, 'New API key issued — it is shown above.');
          }}
        >
          Rotate API key
        </button>
      </div>
    </>
  );
}

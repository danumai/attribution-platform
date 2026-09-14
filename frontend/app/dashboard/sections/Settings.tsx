'use client';
import { ChangeEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { confirmDialog } from '@/components/ui/dialog';
import { GRANTED_ON } from '@/lib/fmt';
import { btn, btnGhost, card, code as codeChip, codeKey, cx, field, hint, label, muted, sectionHead, select } from '@/lib/tw';
import type { Bonus } from '@/lib/types';
import type { SectionProps } from '../types';

/** Where scans are sent, per platform, plus the publisher's own declared joining bonus. */
const DESTINATIONS = [
  ['android_package', 'Google Play package (Android scans)', 'com.example.app'],
  ['ios_app_id', 'App Store id (iPhone scans)', '123456789'],
  ['landing_url', 'Web fallback (desktop scans, and platforms with no app registered)', 'https://example.com/get-the-app'],
] as const;

/**
 * The App Clip carrier, a separate block from the destinations above: these three do not change
 * *where* a scan goes, only how the claim gets across the install.
 */
const APPCLIP = [
  ['slug', 'Your URL prefix', 'dramabox'],
  ['ios_appclip_id', 'App Clip app id', 'ABCDE12345.com.example.app.Clip'],
  ['ios_provider_token', 'App Store Connect provider token (optional)', '123456'],
] as const;

const EMPTY = {
  landing_url: '',
  android_package: '',
  ios_app_id: '',
  deeplink_url: '',
  slug: '',
  ios_appclip_id: '',
  ios_provider_token: '',
};

/**
 * One row of the offers editor. Every field is a string here even where the API takes a number: a
 * half-typed `value` is a string for as long as it is being typed.
 */
type Row = { type: string; label: string; value: string; unit: string; on: Bonus['on'] };

const BLANK: Row = { type: 'coins', label: '', value: '', unit: '', on: 'both' };


export function Settings({ d, busy, act }: Pick<SectionProps, 'd' | 'busy' | 'act'>) {
  const { profile } = d;
  const [dest, setDest] = useState(EMPTY);
  const [rows, setRows] = useState<Row[]>([]);
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
      slug: profile.slug ?? '',
      ios_appclip_id: profile.ios_appclip_id ?? '',
      ios_provider_token: profile.ios_provider_token ?? '',
    });
    setRows(
      (profile.bonuses ?? []).map((b) => ({
        type: b.type,
        label: b.label,
        value: b.value?.toString() ?? '',
        unit: b.unit ?? '',
        on: b.on ?? 'both',
      })),
    );
  }, [profile]);

  const on = (k: keyof typeof dest) => (e: ChangeEvent<HTMLInputElement>) =>
    setDest((prev) => ({ ...prev, [k]: e.target.value }));

  const onRow =
    (i: number, k: keyof Row) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));

  // A row with no wording is a row somebody started and abandoned — dropping it here is what
  // stops "Save" failing on a blank the user cannot see is invalid.
  const payload = { ...dest, bonuses: rows.filter((r) => r.label.trim() && r.type.trim()) };

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
      </div>

      <h2 className={cx(sectionHead, 'mt-8')}>App Clip (iPhone)</h2>
      <div className={cx(card, 'mt-3')}>
        <p className={muted}>
          Optional, and worth doing. Android carries attribution across an install by itself;
          iPhone has no equivalent, so by default we ask the scanner to tap Continue on the
          hand-off screen and carry the reference on the clipboard. Register an App Clip and
          iOS does it silently instead — the camera offers your clip straight from the poster,
          and your full app picks the reference up from a shared container after install.
        </p>
        {APPCLIP.map(([name, text, placeholder]) => (
          <div key={name}>
            <label className={label}>{text}</label>
            <input className={field} value={dest[name]} placeholder={placeholder} onChange={on(name)} />
          </div>
        ))}
        <p className={muted}>
          Set the first two together — either both or neither. Your QR codes then encode{' '}
          <span className={codeChip}>/c/{dest.slug || 'your-prefix'}/&lt;code&gt;</span>, which is
          the URL prefix you register in App Store Connect, and{' '}
          <span className={codeChip}>appclips:</span> your associated domain must name this
          site. The provider token is separate and optional: it adds an App&nbsp;Store campaign
          link so Apple reports a download count you can reconcile against — no per-user data,
          and it never affects who gets paid.
        </p>
        <p className={muted}>
          Changing your prefix after codes are printed orphans every one already in the world.
          Pick it once.
        </p>

        <label className={label}>What you give the user</label>
        <p className={muted}>
          As many offers as you run — coins, a subscription, a discount, anything. The kind is
          your own word for it and your app is what reads it back off an attribution response and
          grants it. This platform records and echoes these; it never issues or fulfils one.
        </p>

        {rows.map((r, i) => (
          <div key={i} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[1.6fr_1fr_0.7fr_0.7fr_1.1fr_auto]">
            <input
              className={field}
              value={r.label}
              placeholder="100 free coins"
              aria-label="Offer wording"
              onChange={onRow(i, 'label')}
            />
            <input
              className={field}
              value={r.type}
              placeholder="coins"
              aria-label="Kind"
              onChange={onRow(i, 'type')}
            />
            <input
              className={field}
              value={r.value}
              inputMode="numeric"
              placeholder="100"
              aria-label="Amount"
              onChange={onRow(i, 'value')}
            />
            <input
              className={field}
              value={r.unit}
              placeholder="coins"
              aria-label="Unit"
              onChange={onRow(i, 'unit')}
            />
            <select className={select} value={r.on} aria-label="Granted on" onChange={onRow(i, 'on')}>
              {/* Same wording the promoter reads back on the partnership row, from one place. */}
              {Object.entries(GRANTED_ON).map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
            </select>
            <button
              className={btnGhost}
              aria-label="Remove offer"
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}

        <button className={cx(btnGhost, 'mt-3')} onClick={() => setRows((prev) => [...prev, BLANK])}>
          Add an offer
        </button>

        <button
          className={cx(btn, 'mt-5')}
          disabled={busy}
          onClick={() =>
            act(() => api('/v1/orgs/me', { method: 'PATCH', body: JSON.stringify(payload) }), 'Destinations saved.')
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

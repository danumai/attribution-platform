'use client';
import type { ReactNode } from 'react';
import { ago, num, when } from '@/lib/fmt';
import { cx, muted } from '@/lib/tw';
import { Table } from '../Table';
import { place } from '@/lib/place';
import { device, handoff } from '../cells';
import type { SectionProps } from '../types';

type Props = Pick<SectionProps, 'd' | 'loading'> & { campaignPicker: ReactNode };

export function Scans({ d, loading, campaignPicker }: Props) {
  // Redemptions carry the publisher's user ref; scans only know the device. Join so a scan row
  // can show who it turned into.
  const userByScan = new Map((d.redemptions ?? []).map((x) => [x.scan_id, x]));

  return (
    <>
      <p className={cx(muted, 'mt-3')}>
        The user column fills in once the scan converts and the publisher reports its user reference.
      </p>
      {campaignPicker}
      <Table
        loading={loading}
        rows={d.scans ?? []}
        empty="No scans recorded."
        cols={[
          { h: 'When', sort: (x) => x.scanned_at, get: (x) => <span title={when(x.scanned_at)}>{ago(x.scanned_at)}</span> },
          { h: 'Campaign', get: (x) => x.campaign_name },
          { h: 'Publisher', get: (x) => x.publisher_name },
          { h: 'QR', sort: (x) => x.qr_code, get: (x) => <code>{x.qr_code}</code> },
          // Edge geo when a CDN resolved it; otherwise the handset's own time zone or locale,
          // shown muted with a leading `~` so an inference is never read as an address.
          {
            h: 'Where',
            sort: (x) => place(x)?.label ?? '',
            get: (x) => {
              const p = place(x);
              if (!p) return <span className={muted} title="No CDN geo, and the handset reported no time zone or locale.">—</span>;
              return (
                <span className={cx(!p.exact && muted)} title={p.title}>
                  {p.label}
                  {x.city ? <span className={cx(muted, 'ml-1.5')}>{x.city}</span> : null}
                </span>
              );
            },
          },
          // device_type is stored from the scan itself; the UA fallback only covers rows
          // recorded before those columns existed.
          {
            h: 'Device',
            sort: (x) => x.device_type ?? device(x.user_agent ?? ''),
            get: (x) => <span title={x.user_agent ?? ''}>{x.device_type ?? device(x.user_agent ?? '')}</span>,
          },
          { h: 'OS', sort: (x) => x.os ?? '', get: (x) => x.os ?? '—' },
          { h: 'Browser', sort: (x) => x.browser ?? '', get: (x) => x.browser ?? '—' },
          { h: 'Lang', sort: (x) => x.language ?? '', get: (x) => x.language ?? '—' },
// Whether the scanner tapped through the hand-off screen. On an iPhone with no App Clip that tap
// IS the attribution — it is what writes the claim to the clipboard.
          {
            h: 'Hand-off',
            sort: (x) => String(x.client?.exit ?? ''),
            get: (x) => {
              const exit = x.client?.exit;
              if (!exit) return <span className={muted} title={handoff(x)}>—</span>;
              return (
                <span className={cx(exit === 'auto' && muted)} title={handoff(x)}>
                  {exit === 'tap' ? 'tapped' : 'timed out'}
                </span>
              );
            },
          },
          {
            h: 'From',
            sort: (x) => x.referer_host ?? '',
            get: (x) => x.referer_host ?? <span className={muted}>camera</span>,
          },
          {
            h: 'User',
            sort: (x) => userByScan.get(x.id)?.publisher_user_ref ?? '',
            get: (x) => {
              const u = userByScan.get(x.id);
              return u ? <code title={u.identified ? 'identified' : 'guest'}>{u.publisher_user_ref}</code> : '—';
            },
          },
          { h: 'Token', sort: (x) => x.consumed, get: (x) => (x.consumed ? 'spent' : 'open') },
          {
            h: 'Converted',
            sort: (x) => x.redeemed,
            get: (x) => (
              <span className={x.redeemed ? 'text-ok' : 'text-mut'}>
                {x.redeemed ? `+${num(x.coins)} coins` : '—'}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}

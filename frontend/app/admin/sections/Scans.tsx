'use client';
import type { ReactNode } from 'react';
import { ago, num, when } from '@/lib/fmt';
import { cx, muted } from '@/lib/tw';
import { Table } from '../Table';
import { country, device, handset } from '../cells';
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
          {
            h: 'Where',
            sort: (x) => x.country ?? '',
            get: (x) =>
              x.country ? (
                <span title={x.city ?? undefined}>
                  {country(x.country)}
                  {x.city ? <span className={cx(muted, 'ml-1.5')}>{x.city}</span> : null}
                </span>
              ) : (
                '—'
              ),
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
          // The signals an iOS match is scored on. Hover carries the rest of them.
          {
            h: 'Handset',
            sort: (x) => x.screen ?? '',
            get: (x) =>
              x.screen ? (
                <code title={handset(x)}>{x.screen}</code>
              ) : (
                <span className={muted} title={handset(x)}>
                  —
                </span>
              ),
          },
          {
            h: 'From',
            sort: (x) => x.referer_host ?? '',
            get: (x) => x.referer_host ?? <span className={muted}>camera</span>,
          },
          { h: 'IP hash', sort: (x) => x.ip_hash ?? '', get: (x) => <code>{x.ip_hash ?? '—'}</code> },
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

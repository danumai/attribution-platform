'use client';
/**
 * The scan-audience panel, rendered identically in the admin console and on a promoter's own
 * campaign page. One component because the two must agree: a promoter reading their campaign
 * and support reading the admin console are looking at the same query, so they should be
 * looking at the same layout too.
 *
 * Flat surfaces and a single motion event, per the console shell rules — a bar list is a
 * ranking, and animating fourteen of them at once would be the page moving, not a bar growing.
 */
import { ReactNode, useMemo, useState } from 'react';
import { num } from './fmt';
import { card, cx, figure, muted, sectionHead, select as selectField, stamp } from './tw';

export interface Bucket {
  key: string;
  scans: number;
  conversions: number;
}
export interface Analytics {
  days: number;
  totals: {
    scans: number;
    devices: number;
    conversions: number;
    coins: number;
    repeat_scans: number;
    geo_known: number;
    conversion_rate: number;
  };
  dims: Record<string, Bucket[]>;
}

/** `Intl` already ships every country name the browser knows — a lookup table would be 250 dead lines. */
const regionNames =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;
const languageNames =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** How each dimension's raw bucket key is printed. Unknown stays "unknown" — an invented name is worse. */
function labelFor(dim: string, key: string): string {
  if (key === 'unknown') return 'unknown';
  try {
    if (dim === 'country') return regionNames?.of(key) ?? key;
    if (dim === 'language') return languageNames?.of(key) ?? key;
  } catch {
    return key; // an unrecognised tag throws rather than returning undefined
  }
  if (dim === 'weekday') return WEEKDAYS[+key] ?? key;
  if (dim === 'hour') return `${key}:00`;
  return key;
}

/** A ranked bar list. The bar is a width, not a chart library. */
function BarList({
  dim,
  rows,
  empty,
  limit = 8,
}: {
  dim: string;
  rows: Bucket[];
  empty: string;
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  const top = rows[0]?.scans || 1;
  const shown = all ? rows : rows.slice(0, limit);

  if (!rows.length) return <p className={cx(muted, 'px-1 py-2')}>{empty}</p>;

  return (
    <div className="grid gap-1.5">
      {shown.map((r) => (
        <div key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-3">
          <div className="relative min-w-0 rounded-sm">
            {/* the bar sits behind the label rather than beside it, so a long name never
                shortens its own measurement */}
            <div
              className="absolute inset-y-0 left-0 rounded-sm bg-accent-soft"
              style={{ width: `${Math.max((r.scans / top) * 100, 2)}%` }}
              aria-hidden="true"
            />
            <span className="relative block truncate px-2 py-1.5 text-[13.5px] text-ink">
              {labelFor(dim, r.key)}
            </span>
          </div>
          <span className="flex shrink-0 items-baseline gap-2.5 tabular-nums">
            <b className="text-[13.5px] font-semibold text-ink">{num(r.scans)}</b>
            <span
              className={cx('w-11 text-right text-[12.5px]', r.conversions ? 'text-ok' : 'text-mut')}
              title={`${num(r.conversions)} of ${num(r.scans)} scans converted`}
            >
              {r.scans ? `${((r.conversions / r.scans) * 100).toFixed(0)}%` : '—'}
            </span>
          </span>
        </div>
      ))}
      {rows.length > limit && (
        <button
          className={cx(muted, 'cursor-pointer bg-transparent px-2 py-1 text-left font-semibold text-accent')}
          onClick={() => setAll((v) => !v)}
        >
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/**
 * A time series as columns. Used for the three dimensions where the *order* carries the
 * meaning — hour of day, day of week, and the daily trend — so they must never be re-sorted
 * into a ranking the way the bar lists are.
 */
function Columns({ dim, rows, empty }: { dim: string; rows: Bucket[]; empty: string }) {
  const top = Math.max(...rows.map((r) => r.scans), 1);
  if (!rows.length) return <p className={cx(muted, 'px-1 py-2')}>{empty}</p>;
  return (
    <div className="flex items-end gap-[3px] overflow-x-auto pb-1" style={{ height: 96 }}>
      {rows.map((r) => (
        <div
          key={r.key}
          className="flex min-w-[9px] flex-1 flex-col justify-end self-stretch"
          title={`${labelFor(dim, r.key)} — ${num(r.scans)} scans, ${num(r.conversions)} converted`}
        >
          <div
            className="rounded-t-[3px] bg-accent"
            style={{ height: `${Math.max((r.scans / top) * 100, 3)}%` }}
          />
          {/* Only the ends and the peak get a tick — 30 rotated date labels is noise, not data. */}
          <span className={cx(stamp, 'mt-1 block truncate text-center text-[10px] leading-none')}>
            {rows.length <= 12 || r.key === rows[0].key || r.key === rows[rows.length - 1].key
              ? labelFor(dim, r.key)
              : ' '}
          </span>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className={card}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <b className={stamp}>{title}</b>
        {note && <span className={cx(muted, 'text-[12px]')}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

const WINDOWS = [7, 30, 90, 365];

/**
 * @param scoped true on a single campaign — drops the per-campaign breakdown, which would be
 *               one bar at 100% and tell the reader nothing.
 */
export function Audience({
  data,
  days,
  onDays,
  scoped = false,
}: {
  data: Analytics | null;
  days: number;
  onDays: (d: number) => void;
  scoped?: boolean;
}) {
  const d = data?.dims ?? {};
  const t = data?.totals;

  // Geo arrives from the CDN in front of the app. Locally there is no CDN, so an empty map is
  // the expected state rather than a fault — say which it is instead of showing a blank panel.
  const geoOff = Boolean(t && t.scans > 0 && t.geo_known === 0);

  const headline = useMemo(
    () =>
      [
        ['scans', num(t?.scans)],
        ['devices', num(t?.devices)],
        ['repeat scans', num(t?.repeat_scans)],
        ['signups', num(t?.conversions)],
        ['scan → signup', `${((t?.conversion_rate ?? 0) * 100).toFixed(1)}%`],
        ['coins granted', num(t?.coins)],
      ] as const,
    [t],
  );

  if (!data) return null;

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select
          className={cx(selectField, 'max-w-[200px]')}
          value={days}
          onChange={(e) => onDays(+e.target.value)}
          aria-label="Reporting window"
        >
          {WINDOWS.map((w) => (
            <option key={w} value={w}>
              Last {w} days
            </option>
          ))}
        </select>
        <span className={muted}>
          Percentages are scan → signup for that row. Hours are UTC.
        </span>
      </div>

      <div className={cx(card, 'mt-3 flex flex-wrap items-center justify-between gap-3')}>
        {headline.map(([k, v]) => (
          <div
            className="flex-auto rounded-md px-4.5 py-3.5 transition-colors duration-200 ease-press hover:bg-card-alt"
            key={k}
          >
            <b className={figure}>{v}</b>
            <span className={cx(stamp, 'mt-0.5 block')}>{k}</span>
          </div>
        ))}
      </div>

      {!t?.scans && (
        <p className={cx(muted, 'mt-3')}>
          No scans in this window. Widen it, or check that the codes are in circulation.
        </p>
      )}

      <h2 className={sectionHead}>Trend</h2>
      <div className="mt-3 grid gap-3">
        <Panel title="Scans per day" note={`last ${data.days} days`}>
          <Columns dim="day" rows={d.day ?? []} empty="No scans in this window." />
        </Panel>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
          <Panel title="Hour of day" note="UTC">
            <Columns dim="hour" rows={d.hour ?? []} empty="No scans in this window." />
          </Panel>
          <Panel title="Day of week">
            <Columns dim="weekday" rows={d.weekday ?? []} empty="No scans in this window." />
          </Panel>
        </div>
      </div>

      <h2 className={sectionHead}>Place</h2>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
        <Panel title="Country" note={geoOff ? 'not resolved' : undefined}>
          <BarList
            dim="country"
            rows={d.country ?? []}
            empty={
              geoOff
                ? 'No CDN in front of this deployment, so no country was resolved.'
                : 'No scans in this window.'
            }
          />
        </Panel>
        <Panel title="City" note={geoOff ? 'not resolved' : undefined}>
          <BarList
            dim="city"
            rows={d.city ?? []}
            empty={geoOff ? 'City needs an edge that resolves it — see Country.' : 'No scans in this window.'}
          />
        </Panel>
        <Panel title="Language">
          <BarList dim="language" rows={d.language ?? []} empty="No scans in this window." />
        </Panel>
      </div>

      <h2 className={sectionHead}>Device</h2>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
        <Panel title="Device type">
          <BarList dim="device_type" rows={d.device_type ?? []} empty="No scans in this window." />
        </Panel>
        <Panel title="Operating system">
          <BarList dim="os" rows={d.os ?? []} empty="No scans in this window." />
        </Panel>
        <Panel title="Browser or in-app view" note="channel signal">
          <BarList dim="browser" rows={d.browser ?? []} empty="No scans in this window." />
        </Panel>
      </div>

      <h2 className={sectionHead}>Placement</h2>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
        <Panel title="QR code" note="one code per placement to make this useful">
          <BarList dim="qr_code" rows={d.qr_code ?? []} empty="No scans in this window." />
        </Panel>
        {!scoped && (
          <Panel title="Campaign">
            <BarList dim="campaign" rows={d.campaign ?? []} empty="No scans in this window." />
          </Panel>
        )}
        <Panel title="Came from" note="“direct” is a camera scan">
          <BarList
            dim="referer_host"
            rows={d.referer_host ?? []}
            empty="No scans in this window."
          />
        </Panel>
        <Panel title="Store destination" note="which listing the scan was sent to">
          <BarList dim="platform" rows={d.platform ?? []} empty="No scans in this window." />
        </Panel>
      </div>
    </>
  );
}

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
import { change, num } from './fmt';
import { Chart } from './chart';
import { Figures } from './ui';
import { card, cx, muted, sectionHead, select as selectField, stamp } from './tw';

/** The two inks every plot in the console is drawn in. Validated as a pair: ΔE 23.9 under
 *  deuteranopia, 28.6 in normal vision, both clear of the surface at better than 3:1. */
export const INK = { scans: 'var(--color-accent)', signups: 'var(--color-ok)' };

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
    /** scans that passed through the hand-off screen and reported handset detail */
    handset_known: number;
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
  // An axis of thirty `2026-08-06`s is a wall. The year is the same on every tick in any
  // window this product offers, so it is the part that goes.
  if (dim === 'day') {
    const d = new Date(`${key}T00:00:00Z`);
    return Number.isNaN(+d)
      ? key
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  // `393x852@3` is a storage format, not a label. Printed as geometry it reads as a handset.
  if (dim === 'screen') {
    const m = /^(\d+)x(\d+)@([\d.]+)$/.exec(key);
    if (m) return `${m[1]} × ${m[2]} @${m[3]}×`;
  }
  if (dim === 'network') return key.toUpperCase();
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
 * A time series, with its gaps put back.
 *
 * The server only returns buckets it counted something in, so a quiet Tuesday is simply
 * absent from the array. Plotted as-is that Tuesday does not flatten the line, it *removes*
 * it — thirty days of traffic with four quiet ones draws as a twenty-six-point series whose
 * x-axis silently compresses, and a fortnight's dip reads as a plateau. Every time series
 * here is expanded against the slots it should have had, so a zero is drawn as a zero.
 */
function fill(rows: Bucket[], keys: string[]): Bucket[] {
  const by = new Map(rows.map((r) => [r.key, r]));
  return keys.map((key) => by.get(key) ?? { key, scans: 0, conversions: 0 });
}

/** Every day in the window, in the database's clock (UTC), oldest first. */
function dayKeys(days: number) {
  const out: string[] = [];
  const t = Date.now();
  for (let i = days - 1; i >= 0; i--)
    out.push(new Date(t - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

const HOUR_KEYS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const WEEKDAY_KEYS = ['1', '2', '3', '4', '5', '6', '7'];

/** The two daily series, every slot present, for callers plotting them outside this panel. */
export function dailySeries(data: Analytics | null) {
  const rows = fill(data?.dims.day ?? [], dayKeys(data?.days ?? 30));
  return { scans: rows.map((r) => r.scans), signups: rows.map((r) => r.conversions) };
}

/**
 * One dimension of the scan data, plotted.
 *
 * `scans` and `conversions` are both counts of scans, so they share one axis and belong on
 * one plot — a second scale here would invent a correlation the data does not contain.
 * The daily window carries both as lines; the clock and calendar panels carry scans as
 * columns and hand the conversion count to the hover readout, because forty-eight bars in
 * a half-width panel is a texture rather than a comparison.
 */
function Series({
  dim,
  rows,
  keys,
  kind,
  caption,
  empty,
}: {
  dim: string;
  rows: Bucket[];
  keys: string[];
  kind: 'line' | 'bar';
  caption: string;
  empty: string;
}) {
  const full = useMemo(() => fill(rows, keys), [rows, keys]);
  if (!rows.length) return <p className={cx(muted, 'px-1 py-2')}>{empty}</p>;

  const labels = full.map((r) => labelFor(dim, r.key));
  const scans = { label: 'scans', color: INK.scans, values: full.map((r) => r.scans) };
  const signups = { label: 'signups', color: INK.signups, values: full.map((r) => r.conversions) };

  return (
    <Chart
      kind={kind}
      labels={labels}
      caption={caption}
      series={kind === 'bar' ? [scans] : [scans, signups]}
      note={
        kind === 'bar'
          ? (i) => {
              const r = full[i];
              return r.scans
                ? `${num(r.conversions)} signups · ${((r.conversions / r.scans) * 100).toFixed(0)}% converted`
                : null;
            }
          : (i) => {
              const r = full[i];
              return r.scans ? `${((r.conversions / r.scans) * 100).toFixed(0)}% converted` : null;
            }
      }
    />
  );
}

/**
 * The daily plot on its own, for a surface that is not the full audience panel.
 *
 * The admin overview is read to answer "is the platform moving", and three integers cannot
 * answer that — a number says where traffic is, only a line says which way it is going. It
 * is the same component, the same query and the same window as the Audience tab, so the two
 * cannot disagree about a day.
 */
export function ScanTrend({ data, className }: { data: Analytics | null; className?: string }) {
  const days = data?.days ?? 30;
  const keys = useMemo(() => dayKeys(days), [days]);
  if (!data) return null;
  return (
    <div className={cx(card, className)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <b className={cx(stamp, 'shrink-0')}>Scans and signups per day</b>
        <span className={cx(muted, 'text-[12px]')}>last {days} days</span>
      </div>
      <Series
        dim="day"
        kind="line"
        rows={data.dims.day ?? []}
        keys={keys}
        caption="Day"
        empty="No scans in this window."
      />
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className={card}>
      {/* the panel's name never wraps: it is the thing being scanned for, and a two-line
          "QR / CODE" reads as two panels. The note gives way instead. */}
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <b className={cx(stamp, 'shrink-0')}>{title}</b>
        {note && <span className={cx(muted, 'min-w-0 flex-1 text-right text-[12px]')}>{note}</span>}
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

  // Handset detail only exists for scans that went through the hand-off screen — iOS into a
  // registered App Store listing. Saying what share that is turns a panel full of "unknown"
  // from a data fault into the coverage number it actually is.
  const handsetPct = t?.scans ? Math.round((t.handset_known / t.scans) * 100) : 0;
  const handsetNote = t?.scans
    ? `${num(t.handset_known)} of ${num(t.scans)} scans · ${handsetPct}%`
    : undefined;

  // The daily series, expanded to every slot in the window, is what the two headline tiles
  // get their shape and their change from. Half the window against the other half is the only
  // comparison this data can honestly make — the server returns one window, not two.
  const half = Math.max(Math.floor((data?.days ?? 30) / 2), 1);
  const dayList = useMemo(() => dayKeys(data?.days ?? 30), [data?.days]);
  const daily = useMemo(() => fill(d.day ?? [], dayList), [d.day, dayList]);

  const headline = useMemo(() => {
    const scans = daily.map((r) => r.scans);
    const signups = daily.map((r) => r.conversions);
    const since = `vs previous ${half} days`;
    const trend = (values: number[]) => {
      const pct = change(values, half);
      return { spark: values, ...(pct === null ? {} : { delta: { pct, since, goodUp: true } }) };
    };
    return [
      { k: 'scans', v: num(t?.scans), ...trend(scans) },
      { k: 'devices', v: num(t?.devices) },
      { k: 'repeat scans', v: num(t?.repeat_scans) },
      { k: 'signups', v: num(t?.conversions), ...trend(signups) },
      { k: 'scan → signup', v: `${((t?.conversion_rate ?? 0) * 100).toFixed(1)}%` },
      { k: 'coins granted', v: num(t?.coins) },
    ];
  }, [t, daily, half]);

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

      <Figures className="mt-3" items={headline} />

      {!t?.scans && (
        <p className={cx(muted, 'mt-3')}>
          No scans in this window. Widen it, or check that the codes are in circulation.
        </p>
      )}

      <h2 className={sectionHead}>Trend</h2>
      <div className="mt-3 grid gap-3">
        <Panel title="Scans and signups per day" note={`last ${data.days} days`}>
          <Series
            dim="day"
            kind="line"
            rows={d.day ?? []}
            keys={dayList}
            caption="Day"
            empty="No scans in this window."
          />
        </Panel>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
          <Panel title="Hour of day" note="UTC">
            <Series
              dim="hour"
              kind="bar"
              rows={d.hour ?? []}
              keys={HOUR_KEYS}
              caption="Hour (UTC)"
              empty="No scans in this window."
            />
          </Panel>
          <Panel title="Day of week">
            <Series
              dim="weekday"
              kind="bar"
              rows={d.weekday ?? []}
              keys={WEEKDAY_KEYS}
              caption="Day of week"
              empty="No scans in this window."
            />
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

      <h2 className={sectionHead}>Handset</h2>
      <p className={cx(muted, 'mt-2 max-w-[68ch]')}>
        Measured on the hand-off screen an iPhone scan passes through on its way to the App
        Store. It is the same evidence an install is matched against, so this section doubles as
        the coverage report behind iOS attribution — “unknown” is a scan that was sent straight
        to a listing, or one where the browser blocked script.
      </p>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
        <Panel title="Screen" note={handsetNote}>
          <BarList
            dim="screen"
            rows={d.screen ?? []}
            empty="No scans in this window."
          />
        </Panel>
        <Panel title="Timezone" note="reported by the device">
          <BarList dim="tz" rows={d.tz ?? []} empty="No scans in this window." />
        </Panel>
        <Panel title="Appearance">
          <BarList dim="theme" rows={d.theme ?? []} empty="No scans in this window." />
        </Panel>
        <Panel title="Connection" note="not reported by Safari">
          <BarList dim="network" rows={d.network ?? []} empty="No scans in this window." />
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

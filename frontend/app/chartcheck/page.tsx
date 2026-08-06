'use client';
/* Throwaway render harness — deleted after the screenshot pass. Touches no API. */
import { Chart } from '@/lib/chart';
import { Figures } from '@/lib/ui';
import { INK } from '@/lib/audience';
import { card, cx, muted, page, sectionHead, stamp } from '@/lib/tw';
import { num } from '@/lib/fmt';

const DAYS = 30;
const labels = Array.from({ length: DAYS }, (_, i) =>
  new Date(Date.now() - (DAYS - 1 - i) * 86400000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  }),
);
const scans = [12, 18, 9, 0, 0, 31, 44, 39, 52, 61, 48, 55, 70, 66, 81, 74, 90, 102, 88, 96, 130, 121, 0, 145, 160, 152, 178, 190, 173, 205];
const signups = scans.map((s, i) => Math.round(s * (0.18 + (i % 5) * 0.03)));
const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
const hourly = [2, 1, 0, 0, 1, 3, 8, 19, 34, 41, 38, 45, 52, 48, 44, 39, 55, 68, 74, 61, 40, 22, 11, 5];
const week = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekly = [120, 155, 141, 168, 210, 96, 74];

export default function ChartCheck() {
  return (
    <main className={page}>
      <h1 className="text-title">Chart check</h1>

      <h2 className={sectionHead}>Stat tiles</h2>
      <Figures
        className="mt-3"
        items={[
          { k: 'scans', v: num(2871), spark: scans, delta: { pct: 0.62, since: 'vs previous 15 days', goodUp: true } },
          { k: 'devices', v: num(1902) },
          { k: 'signups', v: num(418), spark: signups, delta: { pct: -0.13, since: 'vs previous 15 days', goodUp: true } },
          { k: 'scan → signup', v: '14.6%' },
        ]}
      />

      <h2 className={sectionHead}>Two series, one axis</h2>
      <div className={cx(card, 'mt-3')}>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <b className={cx(stamp, 'shrink-0')}>Scans and signups per day</b>
          <span className={cx(muted, 'text-[12px]')}>last 30 days</span>
        </div>
        <Chart
          labels={labels}
          caption="Day"
          series={[
            { label: 'scans', color: INK.scans, values: scans },
            { label: 'signups', color: INK.signups, values: signups },
          ]}
          note={(i) => (scans[i] ? `${((signups[i] / scans[i]) * 100).toFixed(0)}% converted` : null)}
        />
      </div>

      <h2 className={sectionHead}>Single series, columns</h2>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
        <div className={card}>
          <b className={cx(stamp, 'mb-3 block')}>Hour of day</b>
          <Chart
            kind="bar"
            labels={hours}
            caption="Hour (UTC)"
            series={[{ label: 'scans', color: INK.scans, values: hourly }]}
          />
        </div>
        <div className={card}>
          <b className={cx(stamp, 'mb-3 block')}>Day of week</b>
          <Chart
            kind="bar"
            labels={week}
            caption="Day of week"
            series={[{ label: 'scans', color: INK.scans, values: weekly }]}
          />
        </div>
      </div>

      <h2 className={sectionHead}>Single series, area</h2>
      <div className={cx(card, 'mt-3')}>
        <b className={cx(stamp, 'mb-3 block')}>Redemptions per day</b>
        <Chart
          labels={labels}
          caption="Day"
          series={[{ label: 'redemptions', color: INK.scans, values: signups }]}
        />
      </div>
    </main>
  );
}

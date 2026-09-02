'use client';
/**
 * The console's charts, drawn by hand in SVG. No charting dependency: every plot here is a time
 * series or a ranking of at most two series against one axis, which is a path and some ticks.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { compact, num } from './fmt';
import { cx, muted, stampCaps, table, tableWrap, td, tdNum, th, thNum, tr } from './tw';

export type Series = {
  label: string;
  /** any CSS colour; the theme tokens are what every caller passes */
  color: string;
  values: number[];
};

/** The container's inner width, or 0 before the first measurement. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * A clean ceiling and the lines under it: steps of 1, 2 or 5 × 10^k. An axis topped at the data's
 * own maximum prints ticks like 37 and 74 — numbers about this dataset rather than about scale.
 */
export function ticks(max: number, count = 4) {
  if (max <= 0) return { top: 1, lines: [0, 1] };
  const mag = 10 ** Math.floor(Math.log10(max / count));
  const step = Math.max(([1, 2, 5, 10].find((m) => m * mag >= max / count) ?? 10) * mag, 1);
  const top = Math.ceil(max / step) * step;
  const lines: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) lines.push(v);
  return { top, lines };
}

const PAD = { l: 44, r: 12, t: 12, b: 24 };

/** Marker radius, and the surface ring that keeps it legible where marks cross. */
const DOT = 4;

export function Chart({
  kind = 'line',
  labels,
  series,
  height = 168,
  /** what one x position is, in words — heads the table view's first column */
  caption,
  /** printed under each hovered position, after the series rows */
  note,
  empty = 'Nothing to plot in this window.',
  className,
}: {
  kind?: 'line' | 'bar';
  labels: string[];
  series: Series[];
  height?: number;
  caption: string;
  note?: (i: number) => string | null;
  empty?: string;
  className?: string;
}) {
  const [box, w] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const id = useId();

  const n = labels.length;
  const plotW = Math.max(w - PAD.l - PAD.r, 1);
  const plotH = height - PAD.t - PAD.b;
  const { top, lines } = ticks(Math.max(...series.flatMap((s) => s.values), 0));

// A line is plotted on the points, a bar inside a band, so one has a slot width and the other
// does not.
  const band = plotW / Math.max(n, 1);
  const x = (i: number) =>
    kind === 'bar' ? PAD.l + band * (i + 0.5) : PAD.l + (n > 1 ? (plotW * i) / (n - 1) : plotW / 2);
  const y = (v: number) => PAD.t + plotH - (v / top) * plotH;

// Thin the ticks to what can be read rather than to a fixed count: the same 30-day window fits
// eight dates on a wide card and three in a half-width panel.
  const step = Math.max(1, Math.ceil(n / Math.max(Math.floor(plotW / 58), 1)));

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - PAD.l;
    const i = kind === 'bar' ? Math.floor(px / band) : Math.round((px / plotW) * (n - 1));
    setAt(Math.min(Math.max(i, 0), n - 1));
  };

  const key = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    setAt((p) => Math.min(Math.max((p ?? (d > 0 ? -1 : n)) + d, 0), n - 1));
  };

  if (!n) return <p className={cx(muted, 'px-1 py-2')}>{empty}</p>;

  const readout = at != null && at < n;

  return (
    <div className={className}>
      {/* A legend is the dependable identity channel, so it is present whenever there is
          more than one series — and absent when there is one, where a lone swatch only
          restates the panel's own title. */}
      {series.length > 1 && (
        <div className="mb-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1.75 text-[12.5px] text-ink-soft">
              <i
                className="block h-0.5 w-3.5 rounded-full"
                style={{ background: s.color }}
                aria-hidden="true"
              />
              {s.label}
            </span>
          ))}
        </div>
      )}

      <div className="relative" ref={box}>
        {w > 0 && (
          <svg
            width={w}
            height={height}
            className="block touch-pan-y focus-visible:outline-none"
            role="img"
            tabIndex={0}
            aria-describedby={`${id}-table`}
            aria-label={`${caption}. ${series
              .map((s) => `${s.label}: ${num(s.values.reduce((a, b) => a + b, 0))} total`)
              .join(', ')}. Use the arrow keys to read each point, or the table below.`}
            onPointerMove={move}
            onPointerLeave={() => setAt(null)}
            onKeyDown={key}
            onBlur={() => setAt(null)}
          >
            <defs>
              {/* A wash per series, so the fill fades out towards the baseline instead of
                  ending in a hard edge halfway down the plot. A flat fill at one opacity is
                  read as a second, paler mark sitting under the line — a gradient is read as
                  the line's own shadow, which is the only thing an area under a trend line
                  is entitled to mean. */}
              {series.map((s, i) => (
                <linearGradient key={s.label} id={`${id}-wash-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.20" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0.01" />
                </linearGradient>
              ))}
            </defs>

            {/* The grid is dashed and the zero line is not. They were the same hairline
                before, which left the baseline as one gridline among four rather than as the
                floor the marks stand on — and a dashed reference is easier to read a mark
                across, because the eye stops mistaking the grid for data. */}
            {lines.map((v) => (
              <g key={v}>
                {v > 0 && (
                  <line
                    x1={PAD.l}
                    x2={w - PAD.r}
                    y1={y(v)}
                    y2={y(v)}
                    stroke="var(--color-line)"
                    strokeWidth="1"
                    strokeDasharray="2 4"
                    shapeRendering="crispEdges"
                  />
                )}
                {/* Ticks in the mono, not the sans. A column of proportional figures does not
                    line up on its decimal, and an axis is the one place in the console where
                    numbers genuinely stack vertically. */}
                <text
                  x={PAD.l - 8}
                  y={y(v)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-mut font-mono text-[10.5px]"
                >
                  {compact(v)}
                </text>
              </g>
            ))}

            {/* The hover layer, drawn before the marks so a crosshair never crosses a dot.
                The band is what the pointer is actually aiming at — a 1px line asks for a
                precision the reader does not have, and gives no feedback until it is hit. */}
            {readout && kind === 'line' && (
              <g>
                <rect
                  x={Math.max(x(at) - Math.max(plotW / Math.max(n - 1, 1), 12) / 2, PAD.l)}
                  y={PAD.t}
                  width={Math.max(plotW / Math.max(n - 1, 1), 12)}
                  height={plotH}
                  fill="var(--color-line-soft)"
                  opacity="0.7"
                />
                <line
                  x1={x(at)}
                  x2={x(at)}
                  y1={PAD.t}
                  y2={y(0)}
                  stroke="var(--color-mut)"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                  opacity="0.5"
                />
              </g>
            )}

            {kind === 'bar'
              ? series[0].values.map((v, i) => {
// Capped, never filling its slot: the band's leftover is the air that keeps a run of columns from
// reading as one solid block.
                  const bw = Math.max(Math.min(band - 2, 24), 1);
                  const h = (v / top) * plotH;
                  return (
                    <rect
                      key={i}
                      x={x(i) - bw / 2}
                      y={y(v)}
                      width={bw}
                      height={Math.max(h, v > 0 ? 2 : 0)}
                      rx={Math.min(4, bw / 2)}
                      fill={series[0].color}
                      opacity={at == null || at === i ? 1 : 0.45}
                      className="transition-opacity duration-100"
                    />
                  );
                })
              : series.map((s, si) => {
                  const path = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ');
                  return (
                    <g key={s.label}>
                      {/* a wash under a lone series, never under two — two overlapping fills
                          muddy each other and neither reads as a quantity any more */}
                      {series.length === 1 && (
                        <path
                          className="animate-wash"
                          d={`${path} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`}
                          fill={`url(#${id}-wash-${si})`}
                        />
                      )}
                      {/* `pathLength="1"` is what makes the draw-in take the same time on a
                          7-point series and a 90-point one: the dash is measured in units of
                          the whole path rather than in pixels, so the animation describes the
                          series instead of its length. */}
                      <path
                        className="animate-draw"
                        d={path}
                        pathLength={1}
                        strokeDasharray={1}
                        fill="none"
                        stroke={s.color}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* the last point gets a marker: it is where the series is now */}
                      <circle
                        cx={x(n - 1)}
                        cy={y(s.values[n - 1] ?? 0)}
                        r={DOT}
                        fill={s.color}
                        stroke="var(--color-card)"
                        strokeWidth="2"
                      />
                    </g>
                  );
                })}

            {/* The baseline sits over the marks so a bar reads as standing on it, and it is
                inked a step darker than the dashed grid above it — it is the floor, not
                another reference. */}
            <line
              x1={PAD.l}
              x2={w - PAD.r}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--color-mut)"
              strokeWidth="1"
              opacity="0.45"
              shapeRendering="crispEdges"
            />

            {/* Counted back from the newest point, not forward from the oldest: the last tick
                is the one the reader needs, and an axis stepped forward either drops it or
                prints it a few pixels from its neighbour. A bar's label sits under the bar,
                so only a line's two ends need pulling inside the plot. */}
            {labels.map((l, i) =>
              (n - 1 - i) % step === 0 ? (
                <text
                  key={i}
                  x={x(i)}
                  y={height - 7}
                  textAnchor={
                    kind === 'bar' ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
                  }
                  className="fill-mut font-mono text-[10.5px]"
                >
                  {l}
                </text>
              ) : null,
            )}

            {/* The read dots go last, over everything: on a dense series they land on top of
                the line they belong to, and anything drawn after them would cut through. The
                band and crosshair that find the x are behind the marks, above. */}
            {readout && kind === 'line' && (
              <>
                {series.map((s) => (
                  <circle
                    key={s.label}
                    cx={x(at)}
                    cy={y(s.values[at] ?? 0)}
                    r={DOT}
                    fill={s.color}
                    stroke="var(--color-card)"
                    strokeWidth="2"
                  />
                ))}
              </>
            )}
          </svg>
        )}

        {/* One readout, every series — the pointer never has to land on a line to get a
            value. Values lead and labels follow: the reader already has the series. */}
        {readout && w > 0 && (
          <div
            className="pointer-events-none absolute top-0 z-2 min-w-35 rounded-lg border border-line bg-card-high px-3 py-2.5 shadow-pass"
            style={{
              left: Math.min(Math.max(x(at), PAD.l + 60), w - 72),
              transform: 'translateX(-50%)',
            }}
            role="status"
          >
            {/* The position this reads at, stamped — the one label in the console that is a
                heading over figures rather than over a control, so it takes the caps. */}
            <div className={cx(stampCaps, 'mb-1.5 border-b border-line-soft pb-1.5')}>
              {labels[at]}
            </div>
            {series.map((s) => (
              <div
                key={s.label}
                className="flex items-baseline gap-2 text-[12.5px] whitespace-nowrap [&+&]:mt-0.5"
              >
                <i
                  className="block size-1.5 shrink-0 -translate-y-0.5 rounded-full"
                  style={{ background: s.color }}
                  aria-hidden="true"
                />
                {/* Mono, so two series stacked in one card put their digits on the same
                    column and the reader compares magnitudes instead of string lengths. */}
                <b className="font-mono text-[13px] font-medium text-ink">{num(s.values[at])}</b>
                <span className="text-mut">{s.label}</span>
              </div>
            ))}
            {note?.(at) && (
              <div className="mt-1.5 border-t border-line-soft pt-1.5 text-[12px] text-mut">
                {note(at)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* The chart's twin in text. A tooltip that is the only way to read a value gates the
          data behind a pointer; this is what makes the hover layer an enhancement. */}
      <details className="mt-2 group">
        <summary className={cx(muted, 'cursor-pointer list-none text-[12.5px] font-medium text-accent-text hover:underline')}>
          <span className="group-open:hidden">Table view</span>
          <span className="hidden group-open:inline">Hide table</span>
        </summary>
        <div className={cx(tableWrap, 'max-h-70')} id={`${id}-table`}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>{caption}</th>
                {series.map((s) => (
                  <th className={thNum} key={s.label}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr className={tr} key={l}>
                  <td className={td}>{l}</td>
                  {series.map((s) => (
                    <td className={tdNum} key={s.label}>
                      {num(s.values[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/**
 * The twelve-point trace on a stat tile. Deliberately unlabelled and unhoverable: it carries
 * shape, not values — the figure it sits under is the value.
 */
export function Spark({
  values,
  color = 'var(--color-accent-text)',
  className,
}: {
  values: number[];
  color?: string;
  className?: string;
}) {
  const id = useId();
  const v = values.slice(-12);
  if (v.length < 2) return null;
// A trace is read for its slope, and slope is a ratio of the two dimensions — at 64×18 a flat
// week and a doubling week looked nearly alike.
  const [W, H] = [72, 20];
  const top = Math.max(...v, 1);
  const px = (i: number) => (W * i) / (v.length - 1);
  const py = (n: number) => H - 2.5 - (n / top) * (H - 5);
  const path = v.map((n, i) => `${i ? 'L' : 'M'}${px(i)} ${py(n)}`).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L${W} ${H} L0 ${H} Z`} fill={`url(#${id}-s)`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* The terminal dot is the only thing that says which end is now. Without it a trace is
          a shape; with it, it is a position — and the figure beside it is that position's value. */}
      <circle cx={px(v.length - 1)} cy={py(v[v.length - 1])} r="2" fill={color} />
    </svg>
  );
}

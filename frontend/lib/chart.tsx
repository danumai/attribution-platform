'use client';
/**
 * The console's charts, drawn by hand in SVG.
 *
 * There is no charting dependency here on purpose. Every plot this product needs is a
 * time series or a ranking of at most two series against one axis — that is a path
 * string and a scale, not a hundred kilobytes of runtime that would then have to be
 * argued out of its own colours, fonts and tooltips to match the rest of the console.
 *
 * The rules the drawing follows, so a second chart cannot drift from the first:
 *   · one axis, always. Two measures of different scale are two charts, never two scales.
 *   · thin marks on a recessive grid: 2px lines, solid hairline gridlines one step off
 *     the surface, bars capped at 24px so the band keeps its air.
 *   · marks carry the series colour; text never does. Identity reaches the reader through
 *     the legend key beside the label, so it survives being read in greyscale.
 *   · the hover layer ships with the chart, and every value it shows is also reachable
 *     without a pointer — arrow keys move the same crosshair, and the table view under
 *     each plot is the whole series in text.
 *
 * Sizes are real pixels measured off the container rather than a scaled `viewBox`: a
 * non-uniform scale is what turns a 2px stroke into 3px on one axis and an end-dot into
 * an ellipse, and no amount of `vector-effect` fixes the dot.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { compact, num } from './fmt';
import { cx, muted, stamp, table, tableWrap, td, tdNum, th, thNum, tr } from './tw';

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
 * A clean ceiling and the lines under it: steps of 1, 2 or 5 × 10^k.
 *
 * An axis topped at the data's own maximum prints ticks like 37 and 74, which are numbers
 * about this dataset rather than a scale — the reader has to do arithmetic to place a bar.
 */
function ticks(max: number, count = 4) {
  if (max <= 0) return { top: 1, lines: [0, 1] };
  const mag = 10 ** Math.floor(Math.log10(max / count));
  const step = ([1, 2, 5, 10].find((m) => m * mag >= max / count) ?? 10) * mag;
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

  // A line is plotted on the points, a bar inside a band — so one of them has a slot width
  // and the other does not, and every x below comes from whichever this is.
  const band = plotW / Math.max(n, 1);
  const x = (i: number) =>
    kind === 'bar' ? PAD.l + band * (i + 0.5) : PAD.l + (n > 1 ? (plotW * i) / (n - 1) : plotW / 2);
  const y = (v: number) => PAD.t + plotH - (v / top) * plotH;

  // Thin the ticks to what can be read rather than to a fixed count: a 30-day window on a
  // wide card can print eight dates, and the same window in a half-width panel cannot.
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
            {/* the grid is solid hairline, one step off the surface: a reference, never a mark */}
            {lines.map((v) => (
              <g key={v}>
                <line
                  x1={PAD.l}
                  x2={w - PAD.r}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="var(--color-line)"
                  strokeWidth="1"
                  shapeRendering="crispEdges"
                />
                <text
                  x={PAD.l - 8}
                  y={y(v)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-mut text-[11px] tabular-nums"
                >
                  {compact(v)}
                </text>
              </g>
            ))}

            {kind === 'bar'
              ? series[0].values.map((v, i) => {
                  // Capped, never filling its slot: the band's leftover is the air that keeps
                  // a run of columns from reading as one solid block.
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
              : series.map((s) => {
                  const path = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ');
                  return (
                    <g key={s.label}>
                      {/* a wash under a lone series, never under two — two overlapping fills
                          muddy each other and neither reads as a quantity any more */}
                      {series.length === 1 && (
                        <path
                          d={`${path} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`}
                          fill={s.color}
                          fillOpacity="0.1"
                        />
                      )}
                      <path
                        d={path}
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

            {/* the baseline sits over the marks so a bar reads as standing on it */}
            <line
              x1={PAD.l}
              x2={w - PAD.r}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--color-line)"
              strokeWidth="1"
              shapeRendering="crispEdges"
            />

            {labels.map((l, i) =>
              i % step === 0 || i === n - 1 ? (
                <text
                  key={i}
                  x={x(i)}
                  y={height - 7}
                  textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                  className="fill-mut text-[11px] tabular-nums"
                >
                  {l}
                </text>
              ) : null,
            )}

            {/* The crosshair finds the x, so the reader aims at a date rather than at a 2px
                line. On bars the column itself is already the target, so it stays off. */}
            {readout && kind === 'line' && (
              <>
                <line
                  x1={x(at)}
                  x2={x(at)}
                  y1={PAD.t}
                  y2={y(0)}
                  stroke="var(--color-mut)"
                  strokeWidth="1"
                  opacity="0.4"
                />
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
            className="pointer-events-none absolute top-0 z-2 min-w-33 rounded-lg border border-line bg-card px-2.5 py-2 shadow-contact"
            style={{
              left: Math.min(Math.max(x(at), PAD.l + 60), w - 72),
              transform: 'translateX(-50%)',
            }}
            role="status"
          >
            <div className={cx(stamp, 'mb-1')}>{labels[at]}</div>
            {series.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-[12.5px] whitespace-nowrap">
                <i
                  className="block h-0.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: s.color }}
                  aria-hidden="true"
                />
                <b className="font-semibold text-ink tabular-nums">{num(s.values[at])}</b>
                <span className="text-mut">{s.label}</span>
              </div>
            ))}
            {note?.(at) && <div className="mt-1 text-[12px] text-mut">{note(at)}</div>}
          </div>
        )}
      </div>

      {/* The chart's twin in text. A tooltip that is the only way to read a value gates the
          data behind a pointer; this is what makes the hover layer an enhancement. */}
      <details className="mt-2 group">
        <summary className={cx(muted, 'cursor-pointer list-none text-[12.5px] font-medium text-accent hover:underline')}>
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
 * The twelve-point trace on a stat tile.
 *
 * Deliberately unlabelled and unhoverable: it carries shape, not values — the figure it sits
 * under is the value. Fixed geometry, so no measurement and no scaled strokes.
 */
export function Spark({
  values,
  color = 'var(--color-accent)',
  className,
}: {
  values: number[];
  color?: string;
  className?: string;
}) {
  const v = values.slice(-12);
  if (v.length < 2) return null;
  const [W, H] = [64, 18];
  const top = Math.max(...v, 1);
  const px = (i: number) => (W * i) / (v.length - 1);
  const py = (n: number) => H - 1.5 - (n / top) * (H - 3);
  const path = v.map((n, i) => `${i ? 'L' : 'M'}${px(i)} ${py(n)}`).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden="true">
      <path d={`${path} L${W} ${H} L0 ${H} Z`} fill={color} fillOpacity="0.1" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

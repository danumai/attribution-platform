/** Printed-field formatting, shared by every console surface so a figure reads
 *  the same in the promoter portal and the admin one. */

/** Grouped integer. Every coin count on screen goes through this. */
export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString();

/** Grouped integer, shortened. For axis ticks and sparkline captions, where the exact
 *  figure is one hover away and the width is not negotiable. Never for a printed total. */
export const compact = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Signed change of the last `n` points against the `n` before them, as a fraction.
 *
 * `null` whenever the comparison would be invented: fewer than two full windows of data, or
 * a prior window of zero — "up from nothing" has no percentage, and printing one is a lie
 * dressed as a measurement.
 */
export function change(values: number[], n: number) {
  if (values.length < n * 2) return null;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const before = sum(values.slice(-n * 2, -n));
  if (!before) return null;
  return (sum(values.slice(-n)) - before) / before;
}

export const when = (t?: string | null) => (t ? new Date(t).toLocaleString() : '—');

/** Short elapsed time, falling back to the absolute stamp past a week. */
export const ago = (t?: string | null) => {
  if (!t) return '—';
  let s = (Date.now() - new Date(t).getTime()) / 1000;
  for (const [n, u] of [[60, 's'], [60, 'm'], [24, 'h'], [7, 'd']] as const) {
    if (s < n) return `${Math.round(s)}${u} ago`;
    s /= n;
  }
  return when(t);
};

/** Printed-field formatting, shared by every console surface so a figure reads
 *  the same in the promoter portal and the admin one. */

/** Grouped integer. Every coin count on screen goes through this. */
export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString();

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

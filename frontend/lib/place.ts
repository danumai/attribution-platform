/**
 * Where a scan came from: the country name for a code, and the fallback chain behind it.
 *
 * Pure logic rather than a cell in `app/admin/cells.tsx` so it can be unit-tested without a
 * renderer — the inference below is the one part of this table that can be wrong.
 */
import type { AdminScan } from '@/lib/types';

/** `Intl` knows every country name already — a lookup table here would be dead weight. */
const regionNames =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

export const country = (code: string) => {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
};

/**
 * Where one scan came from, and how sure we are.
 *
 * The edge answer is the only one that resolves the scanner's *address*, and it is NULL off a
 * CDN — which is the whole of "shows unknown". One fallback is left: the region the phone's
 * owner set it up with, read from the `Accept-Language` header this request already carried.
 * It is marked `~` and never written back to `country`, because the analytics breakdowns are
 * addresses and a locale is not one — a Dane with an English phone would otherwise turn into a
 * scan from the United States.
 *
 * The time-zone inference that used to sit between them is gone with the signal it read. It was
 * the most accurate of the three, and it was collected by fingerprinting a handset, which is
 * the trade this whole change makes: a coarser answer, honestly obtained.
 */
export function place(x: AdminScan): { label: string; exact: boolean; title: string } | null {
  if (x.country)
    return {
      label: country(x.country),
      exact: true,
      title: [x.city, `${x.country} — resolved at the edge`].filter(Boolean).join(' · '),
    };

  const byLocale = x.language?.split('-')[1]?.toUpperCase();
  if (byLocale && /^[A-Z]{2}$/.test(byLocale))
    return {
      label: `~${country(byLocale)}`,
      exact: false,
      title: `inferred from the browser's Accept-Language (${x.language}) — a region setting, not a location`,
    };

  return null;
}

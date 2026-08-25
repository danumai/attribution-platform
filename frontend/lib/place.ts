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
 * IANA zone → ISO region, asked of ICU rather than shipped as a 400-row table: `getTimeZones()`
 * answers the other direction, so invert it once over every possible two-letter code. Built on
 * first use and kept; `null` on engines without the Locale Info API (Firefox, older Safari),
 * where `place()` simply falls through to the locale.
 */
let zones: Map<string, string> | null | undefined;
const tzRegion = (tz: string): string | null => {
  if (zones === undefined) {
    // Cast: the Locale Info API is newer than the TS lib types, and older engines lack it.
    const timeZonesOf = (l: Intl.Locale) => (l as unknown as { getTimeZones?: () => string[] }).getTimeZones?.();
    zones = timeZonesOf(new Intl.Locale('und-DK')) ? new Map() : null;
    for (let a = 65; zones && a <= 90; a++)
      for (let b = 65; b <= 90; b++) {
        const cc = String.fromCharCode(a, b);
        try {
          for (const z of timeZonesOf(new Intl.Locale(`und-${cc}`)) ?? []) zones.set(z, cc);
        } catch {
          /* not a region ICU knows — the next pair might be */
        }
      }
  }
  return zones?.get(tz) ?? null;
};

/**
 * Where one scan came from, and how sure we are.
 *
 * The edge answer is the only one that resolves the scanner's *address*, and it is NULL off a
 * CDN — which is the whole of "shows unknown". The two fallbacks are the handset's own answers:
 * the time zone it was standing in (hand-off screen, iOS), and the region its owner set the
 * phone up with. Both are marked `~` and neither is ever written back to `country`, because the
 * analytics breakdowns are addresses and a locale is not one — a Dane with an English phone
 * would otherwise turn into a scan from the United States.
 */
export function place(x: AdminScan): { label: string; exact: boolean; title: string } | null {
  if (x.country)
    return {
      label: country(x.country),
      exact: true,
      title: [x.city, `${x.country} — resolved at the edge`].filter(Boolean).join(' · '),
    };

  const byTz = x.tz ? tzRegion(x.tz) : null;
  if (byTz)
    return { label: `~${country(byTz)}`, exact: false, title: `inferred from the handset time zone ${x.tz}` };

  const byLocale = x.language?.split('-')[1]?.toUpperCase();
  if (byLocale && /^[A-Z]{2}$/.test(byLocale))
    return {
      label: `~${country(byLocale)}`,
      exact: false,
      title: `inferred from the device locale ${x.language} — a region setting, not a location`,
    };

  return null;
}

/**
 * Scan breakdowns, shared by the admin console and the promoter's own campaign page.
 *
 * One function, two callers, because the numbers must agree: a promoter comparing their
 * campaign page against what support reads off the admin console should never see two answers.
 * Scoping is the caller's job — the admin passes no campaign (or any campaign), the portal
 * passes only a campaign it has already proved the session owns.
 */
import { prisma } from './prisma';

export interface Bucket {
  key: string;
  scans: number;
  conversions: number;
}

export interface ScanAnalytics {
  days: number;
  totals: {
    scans: number;
    /** distinct hashed IPs — the closest thing to "people" this data supports */
    devices: number;
    conversions: number;
    coins: number;
    /** scans beyond the first from the same device: re-scans, or one device hitting many codes */
    repeat_scans: number;
    /** how many scans the CDN resolved a country for; 0 means geo is simply not wired up */
    geo_known: number;
    conversion_rate: number;
  };
  dims: Record<string, Bucket[]>;
}

/** The dimensions, and the SQL expression that buckets a scan into each. */
const DIMENSIONS: Record<string, string> = {
  country: `coalesce(country, 'unknown')`,
  city: `coalesce(city, 'unknown')`,
  device_type: `coalesce(device_type, 'unknown')`,
  os: `coalesce(os, 'unknown')`,
  browser: `coalesce(browser, 'unknown')`,
  language: `coalesce(language, 'unknown')`,
  platform: `platform`,
  // 'direct' is the interesting bucket here: no referer is what a real camera scan looks like.
  referer_host: `coalesce(referer_host, 'direct')`,
  qr_code: `coalesce(code, 'unknown')`,
  campaign: `campaign_name`,
  // Zero-padded so the buckets sort lexically into clock order without a numeric cast per row.
  hour: `lpad(extract(hour from scanned_at)::text, 2, '0')`,
  // ISO day-of-week: 1 = Monday … 7 = Sunday.
  weekday: `extract(isodow from scanned_at)::text`,
  day: `to_char(scanned_at, 'YYYY-MM-DD')`,
};

const dimensionSql = Object.entries(DIMENSIONS)
  .map(
    ([name, expr]) => `
      SELECT '${name}' AS dim, ${expr} AS key,
             count(*)::int AS scans,
             count(*) FILTER (WHERE converted)::int AS conversions
      FROM s GROUP BY 2`,
  )
  .join(' UNION ALL ');

/**
 * Every breakdown in one round trip.
 *
 * Thirteen `GROUP BY`s could be thirteen queries; as one `UNION ALL` over a single CTE the
 * window of scans is scanned once and reused, and the whole panel is one network hop. The
 * dimension names are interpolated as plain SQL because they come from the constant map above
 * — the only caller-supplied values are the two parameters, which stay bound.
 *
 * Timestamps bucket in the database's timezone (UTC in every deployment here), so "hour" is
 * UTC, not the scanner's local clock. Local hour would need a per-scan offset we do not
 * collect; UTC at least compares honestly across a campaign.
 */
export async function scanAnalytics(campaignId: string | null, days = 30): Promise<ScanAnalytics> {
  const window = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);

  // `$queryRawUnsafe` because the dimension list is built above; `$1`/`$2` keep the two
  // caller-controlled values bound and out of the SQL text.
  const rowsPromise = prisma.$queryRawUnsafe<
    { dim: string; key: string; scans: number; conversions: number }[]
  >(
    `WITH s AS (
       SELECT sc.scanned_at, sc.country, sc.city, sc.device_type, sc.os, sc.browser,
              sc.language, sc.platform, sc.referer_host,
              q.code, c.name AS campaign_name,
              r.id IS NOT NULL AS converted
       FROM scans sc
       JOIN qr_codes q  ON q.id = sc.qr_code_id
       JOIN campaigns c ON c.id = sc.campaign_id
       LEFT JOIN redemptions r ON r.scan_id = sc.id
       WHERE sc.scanned_at > now() - make_interval(days => $2::int)
         AND ($1::uuid IS NULL OR sc.campaign_id = $1::uuid)
     )
     ${dimensionSql}`,
    campaignId,
    window,
  );

  const totalsPromise = prisma.$queryRawUnsafe<Record<string, number>[]>(
    `SELECT count(*)::int                                        AS scans,
            count(DISTINCT sc.ip)::int                           AS devices,
            count(r.id)::int                                     AS conversions,
            coalesce(sum(r.coins), 0)::int                       AS coins,
            count(*) FILTER (WHERE sc.country IS NOT NULL)::int   AS geo_known
     FROM scans sc
     LEFT JOIN redemptions r ON r.scan_id = sc.id
     WHERE sc.scanned_at > now() - make_interval(days => $2::int)
       AND ($1::uuid IS NULL OR sc.campaign_id = $1::uuid)`,
    campaignId,
    window,
  );

  const [rows, [t]] = await Promise.all([rowsPromise, totalsPromise]);

  const dims: Record<string, Bucket[]> = {};
  for (const name of Object.keys(DIMENSIONS)) dims[name] = [];
  for (const r of rows)
    dims[r.dim]?.push({ key: r.key, scans: r.scans, conversions: r.conversions });
  for (const [name, buckets] of Object.entries(dims))
    // Time series read as a timeline; everything else reads as a ranking.
    buckets.sort(
      ['hour', 'weekday', 'day'].includes(name)
        ? (a, b) => (a.key < b.key ? -1 : 1)
        : (a, b) => b.scans - a.scans || (a.key < b.key ? -1 : 1),
    );

  return {
    days: window,
    totals: {
      scans: t.scans,
      devices: t.devices,
      conversions: t.conversions,
      coins: t.coins,
      // A device that scanned once contributes zero here, so this is genuinely the extra scans.
      repeat_scans: Math.max(t.scans - t.devices, 0),
      geo_known: t.geo_known,
      conversion_rate: t.scans ? +(t.conversions / t.scans).toFixed(3) : 0,
    },
    dims,
  };
}

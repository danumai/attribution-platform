/**
 * Scan breakdowns, shared by the admin console and the promoter's own campaign page — one
 * function, two callers, because the numbers must agree. Scoping is the caller's job: the admin
 * passes no campaign, the portal passes one it has already proved the session owns.
 */
import { prisma } from '../config/prisma';

export interface Bucket {
  key: string;
  scans: number;
  conversions: number;
}

interface ScanAnalytics {
  days: number;
  totals: {
    scans: number;
    conversions: number;
    coins: number;
    /** how many scans the CDN resolved a country for; 0 means geo is simply not wired up */
    geo_known: number;
    /**
     * How many iPhone scanners tapped Continue rather than letting the bail-out fire. That tap
     * carries the claim to the clipboard, so on publishers with no App Clip this is the ceiling
     * on how many iOS installs can ever be attributed.
     */
    handoff_tapped: number;
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
  // 'direct' is the interesting bucket: no referer is what a real camera scan looks like.
  referer_host: `coalesce(referer_host, 'direct')`,

  // Screen, timezone, theme and network class were here and were the most interesting panels.
  // They went with the fingerprint they were a by-product of — Apple names browser and device
  // configuration explicitly as data that may not be derived to identify a device.
  //
  // How the hand-off screen was left is about the page rather than the phone. On a publisher with
  // no App Clip, `auto` is an install that could never be attributed.
  handoff: `coalesce(client->>'exit', 'skipped')`,
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
 * Every breakdown in one round trip. Each `GROUP BY` could be its own query; as one `UNION ALL`
 * over a single CTE the window of scans is scanned once and reused. The dimension names are
 * interpolated as plain SQL because they come from the constant map above — the only
 * caller-supplied values are the two bound parameters.
 *
 * Timestamps bucket in the database's timezone (UTC everywhere here), so "hour" is UTC rather
 * than the scanner's local clock, which would need a per-scan offset we do not collect.
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
              sc.language, sc.platform, sc.referer_host, sc.client,
              q.code, c.name AS campaign_name,
              r.n > 0 AS converted
       FROM scans sc
       JOIN qr_codes q  ON q.id = sc.qr_code_id
       JOIN campaigns c ON c.id = sc.campaign_id
       -- Aggregated rather than joined straight through, because one scan can now carry two
       -- redemptions: an acquisition (the scanner was a new user) and an engagement (they had
       -- just bought something). A plain LEFT JOIN would emit that scan twice and silently
       -- inflate every scan count on this dashboard.
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS n FROM redemptions r WHERE r.scan_id = sc.id
       ) r ON true
       WHERE sc.scanned_at > now() - make_interval(days => $2::int)
         AND ($1::uuid IS NULL OR sc.campaign_id = $1::uuid)
     )
     ${dimensionSql}`,
    campaignId,
    window,
  );

  const totalsPromise = prisma.$queryRawUnsafe<Record<string, number>[]>(
    // `conversions` counts scans that paid at least once — a scan that produced both a signup and
    // a purchase reward is still one converted scan — while `coins` sums both, because the
    // campaign budget really did pay for both.
    `SELECT count(*)::int                                        AS scans,
            count(*) FILTER (WHERE r.n > 0)::int                 AS conversions,
            coalesce(sum(r.coins), 0)::int                       AS coins,
            count(*) FILTER (WHERE sc.country IS NOT NULL)::int   AS geo_known,
            count(*) FILTER (WHERE sc.client->>'exit' = 'tap')::int AS handoff_tapped
     FROM scans sc
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS n, coalesce(sum(coins), 0)::int AS coins
       FROM redemptions r WHERE r.scan_id = sc.id
     ) r ON true
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
      conversions: t.conversions,
      coins: t.coins,
      geo_known: t.geo_known,
      handoff_tapped: t.handoff_tapped,
      conversion_rate: t.scans ? +(t.conversions / t.scans).toFixed(3) : 0,
    },
    dims,
  };
}

/**
 * Observability: a request id that follows a request everywhere, structured logs, and counters
 * for the decisions that *are* the product.
 *
 * The failure this exists to catch is the silent one. A publisher who types their
 * `android_package` wrong does not generate errors — every install simply looks organic, the
 * matcher answers `no_match` forever, and nobody is paid. There is no exception to alert on and
 * no row to count, because refusals are never persisted: `installs` and `redemptions` only ever
 * record what *succeeded*. The refusal rate is invisible in the database by construction, which
 * is exactly why it has to be emitted here instead.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

/**
 * Threads the request id through everything one request touches without passing it down every
 * call signature. Stdlib — this is precisely what `AsyncLocalStorage` is for, and a logging
 * library would be a dependency to get the same thing.
 */
const ctx = new AsyncLocalStorage<{ request_id: string }>();

type Fields = Record<string, unknown>;

/**
 * One JSON object per line on stdout, which is what every log pipeline already ingests.
 *
 * Deliberately not a logging library: the whole feature is "JSON.stringify with a timestamp and
 * the ambient request id", and that is four lines. `console` also keeps stdout ordering, which
 * matters when correlating a request log against the container's own output.
 */
function emit(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    request_id: ctx.getStore()?.request_id,
    ...fields,
  };
  // Errors to stderr so a container's log routing can split them without parsing.
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

export const log = {
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
};

/* ---------------------------------------------------------------------------
 * Counters
 *
 * Prometheus text format, rendered by hand. The format is `name{label="v"} 123` and a HELP/TYPE
 * header — a client library would be a dependency for string concatenation.
 *
 * Per-process and reset by a restart, which is correct rather than a shortcut: Prometheus
 * scrapes each instance separately and `rate()` already accounts for counter resets. That is
 * also what makes this work with more than one replica, which the shared limiter below is for.
 * ------------------------------------------------------------------------- */

const counters = new Map<string, number>();

/**
 * Label cardinality is the one way a metrics endpoint becomes an outage, so labels here are
 * closed sets only — a reason, a method, a status class. Anything unbounded (campaign id, user
 * ref, path with ids in it) belongs in the structured log above, where one line costs one line
 * rather than a permanent new time series.
 */
export function count(name: string, labels: Record<string, string | number> = {}) {
  const key = Object.keys(labels).length
    ? `${name}{${Object.entries(labels)
        .map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, '')}"`)
        .join(',')}}`
    : name;
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

/** Prometheus exposition format. `# TYPE` once per metric family, then every labelled series. */
export function renderMetrics(): string {
  const families = new Map<string, string[]>();
  for (const [series, value] of counters) {
    const name = series.split('{')[0];
    if (!families.has(name)) families.set(name, []);
    families.get(name)!.push(`${series} ${value}`);
  }
  const out: string[] = [];
  for (const [name, series] of families) {
    out.push(`# TYPE ${name} counter`, ...series);
  }
  return out.join('\n') + '\n';
}

/* ------------------------------------------------------------------------- */

/**
 * Assigns the request id and logs how every request ended.
 *
 * An inbound `X-Request-Id` is honoured so a trace started at the proxy or by a publisher's own
 * server survives into our logs — bounded and stripped, because it is attacker-controlled text
 * that lands in every log line the request produces.
 *
 * The id is echoed back on the response: when a publisher reports "this claim did not
 * attribute", that header is the whole investigation.
 */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const inbound = req.headers['x-request-id'];
  const request_id =
    (typeof inbound === 'string' && /^[\w.-]{1,64}$/.test(inbound) ? inbound : null) ??
    randomUUID();
  res.setHeader('X-Request-Id', request_id);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    // `req.route?.path` is the *pattern* (`/r/:code`), never the resolved URL — one time series
    // per route instead of one per QR code ever scanned.
    const route = req.route?.path ?? 'unmatched';
    count('http_requests_total', {
      method: req.method,
      route,
      status: `${Math.floor(res.statusCode / 100)}xx`,
    });
    // Health checks are the load balancer talking to itself; logging them buries everything else.
    if (req.path !== '/healthz')
      ctx.run({ request_id }, () =>
        log.info('http.request', {
          method: req.method,
          path: req.path,
          route,
          status: res.statusCode,
          duration_ms: +ms.toFixed(1),
        }),
      );
  });

  ctx.run({ request_id }, next);
}

/**
 * Every attribution decision, paid or refused.
 *
 * `reason` is a closed set (`no_match`, `ambiguous`, `low_confidence`, `budget_exhausted`,
 * `duplicate_device`, `device_integrity`, …) so it is safe as a metric label, and it is the
 * series to alert on: a publisher whose store target is misconfigured shows up as `no_match`
 * going to 100% with no error rate to notice it by.
 *
 * The tenant ids go to the log rather than the metric — that is the drill-down once an alert
 * fires, and as a label it would mint a new time series per campaign forever.
 */
export function recordDecision(
  stage: 'first_open' | 'claim',
  outcome: { reason?: string; match_method?: string; confidence?: number },
  detail: Fields = {},
) {
  const reason = outcome.reason ?? 'attributed';
  count('attribution_decisions_total', {
    stage,
    reason,
    match_method: outcome.match_method ?? 'none',
  });
  log.info('attribution.decision', { stage, reason, ...outcome, ...detail });
}

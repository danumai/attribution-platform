/**
 * Request id, structured logs, and decision counters. Catches the silent failure: a mistyped
 * `android_package` raises no errors, and refusals are never persisted, so the refusal rate is
 * invisible in the database by construction and has to be emitted here.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

/** Threads the request id through a request without putting it in every call signature. */
const ctx = new AsyncLocalStorage<{ request_id: string }>();

type Fields = Record<string, unknown>;

// One JSON object per line. No logging library: `console` keeps stdout ordering.
function emit(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    request_id: ctx.getStore()?.request_id,
    ...fields,
  };
  // stderr so a container's log routing can split errors out without parsing.
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

export const log = {
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
};

// Prometheus text format by hand. Per-process, reset by restart: Prometheus scrapes each instance
// separately and `rate()` already accounts for counter resets.

const counters = new Map<string, number>();

/** Closed-set labels only — label cardinality is how a metrics endpoint becomes an outage. Anything
 *  unbounded (campaign id, user ref, path with ids) belongs in the structured log. */
export function count(name: string, labels: Record<string, string | number> = {}) {
  const key = Object.keys(labels).length
    ? `${name}{${Object.entries(labels)
        .map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, '')}"`)
        .join(',')}}`
    : name;
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

/** Prometheus exposition format: `# TYPE` once per family, then its labelled series. */
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


/**
 * Assigns the request id and logs how every request ended. An inbound `X-Request-Id` is honoured
 * so a proxy-started trace survives, but bounded and stripped — it is attacker-controlled text in
 * every log line. Echoed back, because it is the whole investigation for a reported bad claim.
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
    // The pattern (`/r/:code`), never the resolved URL — one series per route, not per QR code.
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

/** Every attribution decision, paid or refused. `reason` is a closed set and the series to alert
 *  on: a misconfigured store target shows as `no_match` at 100% with no error rate. Tenant ids go
 *  to the log — as labels they would mint a time series per campaign forever. */
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

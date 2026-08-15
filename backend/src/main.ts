import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response, json } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-filter';
import { startReconciliation } from './common/alerts';
import { log, renderMetrics, requestContext } from './common/obs';
import { globalRateLimit, securityHeaders } from './common/security';
import { ENABLE_DOCS, FRONTEND_URLS, METRICS_TOKEN, REDIS_URL, TRUST_PROXY } from './config';
import { prisma } from './database/prisma';
import { closeRedis } from './database/redis';
import { seedAccounts } from './database/seed';

async function bootstrap() {
  // Schema is owned by `prisma migrate deploy`, which runs before the process starts
  // (see the Dockerfile CMD and the `db:deploy` script) — never by the app at boot.
  await seedAccounts();

  // `bodyParser: false` because this file mounts its own below. Nest's default one is
  // registered during `listen()`, i.e. *after* every `app.use` here — so leaving it on meant a
  // second parser behind the first, and the rate limiter's "before the body parser" position
  // held only by accident of which middleware happened to consume the stream first.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // req.ip must reflect the real client, or per-IP rate limits collapse to one bucket
  app.getHttpAdapter().getInstance().set('trust proxy', TRUST_PROXY);

  // Generated straight from the live controllers — a new route shows up here with no extra
  // step. Mounted before securityHeaders: that middleware's `default-src 'none'` CSP would
  // otherwise block Swagger UI's own JS/CSS, and Express never reaches later middleware for
  // a route this already answered.
  //
  // Off by default in production. `/docs` is unauthenticated and enumerates every route,
  // parameter and error shape in the system — free reconnaissance, and it also sits ahead of
  // both securityHeaders and globalRateLimit for the reason above.
  if (ENABLE_DOCS) {
    const swaggerDoc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('QR Reward Platform API')
        .setDescription('See SYSTEM_FLOW.md for the end-to-end role flows behind these routes.')
        .setVersion('1.0')
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Session token from /v1/auth/signup or /login (12h)' },
          'session',
        )
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'pk_…', description: "Publisher's Partner API key" },
          'apiKey',
        )
        .build(),
    );
    SwaggerModule.setup('docs', app, swaggerDoc);
  }

  // Turns a driver-level error (a malformed uuid in the URL, most often) into the 4xx it
  // actually is, instead of an unhandled 500. See prisma-filter.ts.
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));

  // First, so every log line and every 429 below already carries a request id.
  app.use(requestContext);

  /**
   * Scrape target. Mounted here rather than on a controller because it must sit ahead of the
   * global rate limiter (a throttled scrape blinds the monitoring exactly when traffic is
   * interesting) and outside the CSP that `securityHeaders` sets for JSON routes.
   *
   * Token-gated, and in production absent entirely unless a token is configured: the series it
   * exposes include the attribution refusal rates, which describe this platform's payout
   * behaviour to anyone who asks.
   */
  app.use('/metrics', (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();
    if (!METRICS_TOKEN) return res.status(404).end();
    const presented = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    // Constant-time: a token compared with `!==` leaks its prefix to a patient prober.
    const ok =
      presented.length === METRICS_TOKEN.length &&
      timingSafeEqual(Buffer.from(presented), Buffer.from(METRICS_TOKEN));
    if (!ok) return res.status(401).end();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(renderMetrics());
  });

  app.use(securityHeaders);
  // Before the body parser: a flood should be turned away without first buying it 1mb of
  // JSON parsing per request.
  app.use(globalRateLimit);
  // `verify` stashes the raw bytes for the payment webhook's HMAC check — a signature is over
  // what was sent, and re-serialising the parsed body is not that.
  app.use(
    json({
      limit: '1mb', // room for logo data URLs
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.enableCors({ origin: FRONTEND_URLS });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port); // dual-stack :: — browsers resolve localhost to ::1 first
  log.info('server.started', {
    port,
    docs: ENABLE_DOCS,
    // The two that decide whether this process is safe to replicate: without a shared limiter
    // store, a second instance doubles every per-IP security limit.
    shared_rate_limiter: Boolean(REDIS_URL),
    metrics: Boolean(METRICS_TOKEN),
  });
  if (!REDIS_URL)
    log.warn('ratelimit.process_local', {
      detail: 'REDIS_URL unset — per-IP limits are per-instance. Safe for exactly one replica.',
    });

  // The ledger's integrity checks on a clock instead of a dashboard load — drift means
  // something is spending against a wrong number, and it must not wait to be noticed.
  startReconciliation();

  // Drain in-flight requests before the process dies: a redeploy mid-transaction would
  // otherwise leave a scan use claimed with no redemption written against it.
  for (const sig of ['SIGTERM', 'SIGINT'] as const)
    process.once(sig, async () => {
      log.info('server.draining', { signal: sig });
      await app.close().catch(() => {});
      await prisma.$disconnect().catch(() => {});
      await closeRedis();
      process.exit(0);
    });
}

bootstrap().catch((e) => {
  console.error('failed to start', e);
  process.exit(1);
});

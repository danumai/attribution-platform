import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
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
import { prisma } from './config/prisma';
import { closeRedis } from './config/redis';
import { seedAccounts } from './seed';

async function bootstrap() {
  // Schema is owned by `prisma migrate deploy`, which runs before this process starts — never by
  // the app at boot.
  await seedAccounts();

  // `bodyParser: false` because this file mounts its own below. Nest registers its default during
  // `listen()`, i.e. after every `app.use` here, which made the rate limiter's position accidental.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // req.ip must reflect the real client, or per-IP rate limits collapse to one bucket
  app.getHttpAdapter().getInstance().set('trust proxy', TRUST_PROXY);

  // Mounted before securityHeaders: that middleware's `default-src 'none'` would block Swagger
  // UI's own assets, and Express never reaches later middleware for a route this has answered.
  // Also why it is off by default in production — `/docs` sits ahead of the rate limiter.
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

  // Turns a driver-level error (usually a malformed uuid in the URL) into the 4xx it actually is
  // rather than an unhandled 500. See prisma-filter.ts.
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));

  app.useGlobalPipes(
    new ValidationPipe({
      // `transform: true` is load-bearing, not tidiness: the DTOs normalise as well as check —
      // a landing_url is stored as `new URL(x).toString()`, an email lowercased — and without
      // this the handler receives the raw body and writes the un-normalised value.
      transform: true,
      whitelist: true,
      // Deliberately off. The Partner API ignores the old iOS fingerprint fields rather than
      // rejecting them, so an un-upgraded publisher SDK degrades to "no claim carried" instead
      // of breaking; `whitelist` strips them, and forbidding them would turn a third party's
      // pending deploy into a 400 on every call. See readCarried in partner.controller.ts.
      forbidNonWhitelisted: false,
    }),
  );

  // First, so every log line and every 429 below already carries a request id.
  app.use(requestContext);

  /**
   * Scrape target. Mounted here rather than on a controller so it sits ahead of the global rate
   * limiter — a throttled scrape blinds monitoring when traffic is interesting — and outside the
   * CSP `securityHeaders` sets. Token-gated: the series expose this platform's payout behaviour.
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
  // Before the body parser: a flood should be turned away without first buying it 1mb of JSON
  // parsing per request.
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
    // The two that decide whether this process is safe to replicate.
    shared_rate_limiter: Boolean(REDIS_URL),
    metrics: Boolean(METRICS_TOKEN),
  });
  if (!REDIS_URL)
    log.warn('ratelimit.process_local', {
      detail: 'REDIS_URL unset — per-IP limits are per-instance. Safe for exactly one replica.',
    });

  // The ledger's integrity checks on a clock rather than a dashboard load: drift means something
  // is spending against a wrong number.
  startReconciliation();

  // Drain in-flight requests before the process dies, or a redeploy mid-transaction leaves a scan
  // use claimed with no redemption written against it.
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

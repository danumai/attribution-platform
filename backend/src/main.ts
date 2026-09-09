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
  // Schema is owned by `prisma migrate deploy`, which runs before this process starts.
  await seedAccounts();

  // `bodyParser: false`: Nest registers its default during `listen()`, i.e. after every `app.use`
  // here, which would make the rate limiter's position accidental. This file mounts its own below.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // req.ip must reflect the real client, or per-IP rate limits collapse to one bucket
  app.getHttpAdapter().getInstance().set('trust proxy', TRUST_PROXY);

  // Before securityHeaders: its `default-src 'none'` would block Swagger UI's own assets. Off by
  // default in production because `/docs` then sits ahead of the rate limiter.
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

  // Maps driver errors (usually a malformed uuid in the URL) to 4xx, not 500. See prisma-filter.ts.
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));

  app.useGlobalPipes(
    new ValidationPipe({
      // Load-bearing: DTOs normalise as well as check (landing_url via `new URL(x).toString()`,
      // email lowercased). Without it the handler writes the un-normalised value.
      transform: true,
      whitelist: true,
      // Off deliberately: `whitelist` already strips the old iOS fingerprint fields, so an
      // un-upgraded publisher SDK degrades instead of 400ing. See readCarried in partner.controller.ts.
      forbidNonWhitelisted: false,
    }),
  );

  // First: every log line and 429 below needs the request id.
  app.use(requestContext);

  // Scrape target mounted here, not on a controller: ahead of the global rate limiter (a throttled
  // scrape blinds monitoring) and outside `securityHeaders`' CSP. Token-gated: exposes payout data.
  app.use('/metrics', (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();
    if (!METRICS_TOKEN) return res.status(404).end();
    const presented = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    // Constant-time: `!==` leaks the token's prefix to a patient prober.
    const ok =
      presented.length === METRICS_TOKEN.length &&
      timingSafeEqual(Buffer.from(presented), Buffer.from(METRICS_TOKEN));
    if (!ok) return res.status(401).end();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(renderMetrics());
  });

  app.use(securityHeaders);
  // Before the body parser: turn a flood away without first buying it 1mb of JSON parsing each.
  app.use(globalRateLimit);
  // `verify` stashes the raw bytes for the payment webhook's HMAC — the signature is over what was
  // sent, and re-serialising the parsed body is not that.
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

  // Ledger integrity on a clock, not a dashboard load: drift means something is spending wrong.
  startReconciliation();

  // Drain in-flight requests, or a redeploy mid-transaction leaves a scan use claimed with no
  // redemption written against it.
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

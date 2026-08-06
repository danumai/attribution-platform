import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-filter';
import { globalRateLimit, securityHeaders } from './common/security';
import { ENABLE_DOCS, FRONTEND_URLS, TRUST_PROXY } from './config';
import { prisma } from './database/prisma';
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

  app.use(securityHeaders);
  // Before the body parser: a flood should be turned away without first buying it 1mb of
  // JSON parsing per request.
  app.use(globalRateLimit);
  app.use(json({ limit: '1mb' })); // room for logo data URLs
  app.enableCors({ origin: FRONTEND_URLS });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port); // dual-stack :: — browsers resolve localhost to ::1 first
  console.log(`backend on port ${port}${ENABLE_DOCS ? ', swagger docs on /docs' : ''}`);

  // Drain in-flight requests before the process dies: a redeploy mid-transaction would
  // otherwise leave a scan use claimed with no redemption written against it.
  for (const sig of ['SIGTERM', 'SIGINT'] as const)
    process.once(sig, async () => {
      console.log(`${sig} received, draining`);
      await app.close().catch(() => {});
      await prisma.$disconnect().catch(() => {});
      process.exit(0);
    });
}

bootstrap().catch((e) => {
  console.error('failed to start', e);
  process.exit(1);
});

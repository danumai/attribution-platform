import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';
import { securityHeaders } from './common/security';
import { FRONTEND_URLS } from './config';
import { prisma } from './database/prisma';
import { seedAccounts } from './database/seed';

async function bootstrap() {
  // Schema is owned by `prisma migrate deploy`, which runs before the process starts
  // (see the Dockerfile CMD and the `db:deploy` script) — never by the app at boot.
  await seedAccounts();

  const app = await NestFactory.create(AppModule);
  // req.ip must reflect the real client, or per-IP rate limits collapse to one bucket
  app.getHttpAdapter().getInstance().set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  app.use(securityHeaders);
  app.use(json({ limit: '1mb' })); // room for logo data URLs
  app.enableCors({ origin: FRONTEND_URLS });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port); // dual-stack :: — browsers resolve localhost to ::1 first
  console.log(`backend on port ${port}`);

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

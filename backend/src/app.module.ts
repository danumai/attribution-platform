import { Module } from '@nestjs/common';
import { PrismaModule } from './config/prisma';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { PartnerModule } from './modules/partner/partner.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PortalModule } from './modules/portal/portal.module';
import { PublicController } from './modules/public/public.controller';

/**
 * Modules appear here as they gain providers. `PublicController` is still listed directly because
 * it has none — it is the unauthenticated scan redirect, holding its own queries — and a
 * `@Module({ controllers: [...] })` file for it would be two files saying nothing.
 */
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AdminModule,
    PortalModule,
    PartnerModule,
    PaymentsModule,
  ],
  controllers: [PublicController],
})
export class AppModule {}

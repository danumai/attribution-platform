import { Module } from '@nestjs/common';
import { PrismaModule } from './config/prisma';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { PartnerModule } from './modules/partner/partner.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PortalModule } from './modules/portal/portal.module';
import { PublicController } from './modules/public/public.controller';

// `PublicController` is listed directly because it has no providers — it is the unauthenticated
// scan redirect, holding its own queries, so a `@Module` wrapper would say nothing.
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

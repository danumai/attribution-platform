import { Module } from '@nestjs/common';
import { AdminController } from './modules/admin/admin.controller';
import { AuthController } from './modules/auth/auth.controller';
import { IssueController } from './modules/partner/issue.controller';
import { PartnerController } from './modules/partner/partner.controller';
import { PaymentsController } from './modules/payments/payments.controller';
import { PortalController } from './modules/portal/portal.controller';
import { PublicController } from './modules/public/public.controller';

// One module: none of these controllers have providers to scope, so a feature module each
// would be five files of `@Module({ controllers: [...] })` and nothing else.
@Module({
  controllers: [
    AuthController,
    PortalController,
    PublicController,
    PartnerController,
    IssueController,
    PaymentsController,
    AdminController,
  ],
})
export class AppModule {}

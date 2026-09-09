import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PortalController } from './portal.controller';
import { PortalRepository } from './portal.repository';
import { PortalService } from './portal.service';

/** `AuthModule` is imported for `AuthGuard`, which the controller declares on every route. */
@Module({
  imports: [AuthModule],
  controllers: [PortalController],
  providers: [PortalService, PortalRepository],
})
export class PortalModule {}

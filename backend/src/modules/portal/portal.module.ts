import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PortalController } from './portal.controller';
import { PortalRepository } from './portal.repository';
import { PortalService } from './portal.service';

// `AuthModule` for `AuthGuard`, declared on every controller route.
@Module({
  imports: [AuthModule],
  controllers: [PortalController],
  providers: [PortalService, PortalRepository],
})
export class PortalModule {}

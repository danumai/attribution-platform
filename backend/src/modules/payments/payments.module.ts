import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsController } from './payments.controller';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

/**
 * `AuthModule` is imported for `AuthGuard`, which the two promoter-facing routes declare. The
 * webhook deliberately carries no guard — it authenticates by HMAC, not by session.
 */
@Module({
  imports: [AuthModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository],
})
export class PaymentsModule {}

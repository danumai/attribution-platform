import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard, AdminGuard } from './auth.guard';
import { AuthService } from './auth.service';

/**
 * The guards are exported as providers so every module that `@UseGuards(AuthGuard)` gets the same
 * instance rather than one constructed per consuming module.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, AdminGuard],
  exports: [AuthGuard, AdminGuard],
})
export class AuthModule {}

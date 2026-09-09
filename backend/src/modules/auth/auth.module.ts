import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard, AdminGuard } from './auth.guard';
import { AuthService } from './auth.service';

// Guards are exported as providers so every `@UseGuards(AuthGuard)` shares one instance.
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, AdminGuard],
  exports: [AuthGuard, AdminGuard],
})
export class AuthModule {}

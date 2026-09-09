import { BadRequestException, Body, Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { clientIp, rateLimited } from '../../common/security';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ResetDto } from './dto/reset.dto';
import { SignupDto } from './dto/signup.dto';

@ApiTags('Auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Per-IP ceilings live in the controller because they need the request, not the body. They run
   * after the global ValidationPipe by design — plain flooding is the 300/min limiter's job.
   */
  @Post('signup')
  async signup(@Req() req: Request, @Body() dto: SignupDto) {
    if (await rateLimited(`signup:${clientIp(req)}`, 10))
      throw new BadRequestException('too many signups, try again shortly');
    return this.auth.signup(dto);
  }

  /**
   * Complete an admin-issued password reset. Token arrives out of band via
   * `POST /v1/admin/orgs/:id/reset-token`; this endpoint is deliberately mailer-free.
   */
  @Post('reset')
  async reset(@Req() req: Request, @Body() dto: ResetDto) {
    if (await rateLimited(`reset:${clientIp(req)}`, 10))
      throw new UnauthorizedException('too many attempts, try again shortly');
    return this.auth.reset(dto);
  }

  @Post('login')
  async login(@Req() req: Request, @Body() dto: LoginDto) {
    const { email, password } = this.auth.loginCredentials(dto);
    // Two buckets: per-IP stops credential stuffing across accounts, per-account stops distributed
    // brute force against one. Sliced to 254 (`signup`'s ceiling) — the key is retained and attacker-fed.
    if (
      (await rateLimited(`login-ip:${clientIp(req)}`, 20)) ||
      (await rateLimited(`login-acct:${email.slice(0, 254)}`, 10))
    )
      throw new UnauthorizedException('too many attempts, try again shortly');
    return this.auth.login(email, password);
  }
}

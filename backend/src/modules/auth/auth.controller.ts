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
   * The per-IP ceilings stay in the controller because they are the one thing here that needs the
   * request rather than the body.
   *
   * They now run *after* validation, where they used to run before it: the global ValidationPipe
   * is ahead of the handler. That is deliberate on all three routes — a malformed body creates no
   * account and guesses no token, so it is not what these buckets exist to slow down, and the
   * 300/min global limiter in main.ts still covers plain flooding. `login` validates nothing at
   * all, so its ordering is unchanged.
   */
  @Post('signup')
  async signup(@Req() req: Request, @Body() dto: SignupDto) {
    if (await rateLimited(`signup:${clientIp(req)}`, 10))
      throw new BadRequestException('too many signups, try again shortly');
    return this.auth.signup(dto);
  }

  /**
   * Complete an admin-issued password reset. The token arrives out of band, via
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
    // Two buckets: per-IP stops credential stuffing across many accounts, per-account stops a
    // distributed brute force against one. The account key is sliced because it is
    // attacker-controlled and becomes a *retained* map key — 254 is the address ceiling `signup`
    // enforces, so no real login is truncated into somebody else's bucket.
    if (
      (await rateLimited(`login-ip:${clientIp(req)}`, 20)) ||
      (await rateLimited(`login-acct:${email.slice(0, 254)}`, 10))
    )
      throw new UnauthorizedException('too many attempts, try again shortly');
    return this.auth.login(email, password);
  }
}

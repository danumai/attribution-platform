import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import * as bcrypt from 'bcryptjs';
import { Request } from 'express';
import { clientIp, rateLimited, sha256, validateLandingUrl } from '../../common/security';
import { prisma } from '../../database/prisma';
import { newApiKey, signSession } from './tokens';

@ApiTags('Auth')
@Controller('v1/auth')
export class AuthController {
  @Post('signup')
  async signup(
    @Req() req: Request,
    @Body()
    b: { name: string; email: string; password: string; type: string; landing_url?: string },
  ) {
    if (rateLimited(`signup:${clientIp(req)}`, 10))
      throw new BadRequestException('too many signups, try again shortly');
    if (!b.name || !b.email || !b.password || !['promoter', 'publisher'].includes(b.type))
      throw new BadRequestException('name, email, password, type(promoter|publisher) required');
    if (b.password.length < 8) throw new BadRequestException('password min 8 chars');
    const landing_url = validateLandingUrl(b.landing_url);
    const apiKey = b.type === 'publisher' ? newApiKey() : null;
    let org;
    try {
      org = await prisma.org.create({
        data: {
          name: b.name,
          type: b.type,
          email: b.email.toLowerCase(),
          password_hash: await bcrypt.hash(b.password, 10),
          api_key_hash: apiKey ? sha256(apiKey) : null,
          landing_url,
        },
        select: { id: true, name: true, type: true },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new BadRequestException('email already registered');
      throw e;
    }
    return {
      token: signSession({ org_id: org.id, type: org.type as any }),
      org,
      // shown once — publisher must store it
      api_key: apiKey,
    };
  }

  @Post('login')
  async login(@Req() req: Request, @Body() b: { email: string; password: string }) {
    const email = (b.email ?? '').toLowerCase();
    // Two buckets: per-IP stops credential stuffing across many accounts, per-account stops
    // a distributed brute force against one account.
    if (rateLimited(`login-ip:${clientIp(req)}`, 20) || rateLimited(`login-acct:${email}`, 10))
      throw new UnauthorizedException('too many attempts, try again shortly');
    const org = await prisma.org.findUnique({ where: { email } });
    if (!org || !(await bcrypt.compare(b.password ?? '', org.password_hash)))
      throw new UnauthorizedException('invalid credentials');
    if (org.suspended) throw new UnauthorizedException('account suspended');
    return {
      token: signSession({ org_id: org.id, type: org.type as any }),
      org: { id: org.id, name: org.name, type: org.type },
    };
  }
}

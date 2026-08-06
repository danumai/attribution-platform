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
import {
  validateAndroidPackage,
  validateBonusLabel,
  validateIosAppId,
} from '../../common/attribution';
import { clientIp, rateLimited, sha256, str, validateLandingUrl } from '../../common/security';
import { prisma } from '../../database/prisma';
import { asOrgType, newApiKey, signSession } from './tokens';

/** A real bcrypt hash of a value nothing can match, so the no-such-account path costs the
 *  same as the wrong-password path. Cost 10 to match what `signup` writes. */
const DUMMY_HASH = bcrypt.hashSync('unmatchable-placeholder-password', 10);

/**
 * bcrypt silently ignores everything past 72 bytes, so without a ceiling a 200-character
 * passphrase is only ever its first 72 bytes — and any other string sharing that prefix
 * would log in. Rejecting is honest; truncating is a trap.
 */
const MAX_PASSWORD = 72;

@ApiTags('Auth')
@Controller('v1/auth')
export class AuthController {
  @Post('signup')
  async signup(
    @Req() req: Request,
    @Body()
    b: {
      name: string;
      email: string;
      password: string;
      type: string;
      landing_url?: string;
      android_package?: string;
      ios_app_id?: string;
      bonus_label?: string;
    },
  ) {
    if (await rateLimited(`signup:${clientIp(req)}`, 10))
      throw new BadRequestException('too many signups, try again shortly');
    if (!b.name || !b.email || !b.password || !['promoter', 'publisher'].includes(b.type))
      throw new BadRequestException('name, email, password, type(promoter|publisher) required');
    const name = str(b.name, 'name', 120)!;
    const email = str(b.email, 'email', 254)!.toLowerCase();
    // Shape check only — the address is proven by nothing here, so it stays a display field.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new BadRequestException('email must be a valid address');
    // Through `str` like every other field: a non-string password reached `.length` as
    // `undefined` (so the minimum silently passed) and then threw inside `byteLength` as a 500.
    // The cap here is generous on purpose — the real ceiling is the byte check below.
    const password = str(b.password, 'password', 200)!;
    if (password.length < 8) throw new BadRequestException('password min 8 chars');
    if (Buffer.byteLength(password) > MAX_PASSWORD)
      throw new BadRequestException(`password must be ${MAX_PASSWORD} bytes or fewer`);
    const landing_url = validateLandingUrl(b.landing_url);
    const android_package = validateAndroidPackage(b.android_package);
    const ios_app_id = validateIosAppId(b.ios_app_id);
    const bonus_label = validateBonusLabel(b.bonus_label);
    const apiKey = b.type === 'publisher' ? newApiKey() : null;
    let org;
    try {
      org = await prisma.org.create({
        data: {
          name,
          type: b.type,
          email,
          password_hash: await bcrypt.hash(password, 10),
          api_key_hash: apiKey ? sha256(apiKey) : null,
          landing_url,
          android_package,
          ios_app_id,
          bonus_label,
        },
        select: { id: true, name: true, type: true },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new BadRequestException('email already registered');
      throw e;
    }
    return {
      token: signSession({ org_id: org.id, type: asOrgType(org.type) }),
      org,
      // shown once — publisher must store it
      api_key: apiKey,
    };
  }

  @Post('login')
  async login(@Req() req: Request, @Body() b: { email: string; password: string }) {
    // Coerced rather than validated: a non-string email or password is just a credential that
    // cannot match, and answering 400 here would tell a prober something 401 does not.
    const email = typeof b.email === 'string' ? b.email.toLowerCase() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    // Two buckets: per-IP stops credential stuffing across many accounts, per-account stops
    // a distributed brute force against one account.
    // The account key is sliced because it is attacker-controlled and becomes a *retained* map
    // key: a body full of 1mb emails is otherwise a megabyte of resident memory per request
    // until the sweep runs. 254 is the address ceiling `signup` enforces, so no real login
    // is ever truncated into somebody else's bucket.
    if (
      (await rateLimited(`login-ip:${clientIp(req)}`, 20)) ||
      (await rateLimited(`login-acct:${email.slice(0, 254)}`, 10))
    )
      throw new UnauthorizedException('too many attempts, try again shortly');
    const org = await prisma.org.findUnique({ where: { email } });
    // Hash even when the account does not exist. Otherwise an unknown email returns in
    // microseconds and a known one takes bcrypt's ~100ms, which is a reliable oracle for
    // enumerating exactly which addresses are registered on this platform.
    const ok = await bcrypt.compare(password, org?.password_hash ?? DUMMY_HASH);
    if (!org || !ok) throw new UnauthorizedException('invalid credentials');
    if (org.suspended) throw new UnauthorizedException('account suspended');
    return {
      token: signSession({ org_id: org.id, type: asOrgType(org.type) }),
      org: { id: org.id, name: org.name, type: org.type },
    };
  }
}

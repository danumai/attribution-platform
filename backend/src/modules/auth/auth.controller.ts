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
  validateBonuses,
  validateIosAppId,
} from '../../common/attribution';
import {
  clientIp,
  rateLimited,
  sha256,
  str,
  validateDeeplinkUrl,
  validateLandingUrl,
} from '../../common/security';
import { AUTO_APPROVE_PUBLISHERS } from '../../config';
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
      deeplink_url?: string;
      /** the offers this publisher grants itself — see `validateBonuses` */
      bonuses?: unknown;
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
    const bonuses = validateBonuses(b.bonuses);
    const deeplink_url = validateDeeplinkUrl(b.deeplink_url);
    // Both tenant types get one now, because both have a server that calls this platform.
    // A publisher's key answers "is this attributable" and earns fees; a promoter's mints a
    // transaction code per purchase on `/v1/issue` and spends them. Minting one unconditionally
    // is also what keeps the two paths symmetric — a promoter that later runs an engagement
    // campaign does not have to discover that its account was created without a credential.
    const apiKey = newApiKey();
    // Approval gates the *publisher* side only — publishers receive money, so in production a
    // human looks first. Promoters pay in and gate themselves with their own budget.
    const approved = b.type === 'promoter' || AUTO_APPROVE_PUBLISHERS;
    let org;
    try {
      org = await prisma.org.create({
        data: {
          name,
          type: b.type,
          email,
          password_hash: await bcrypt.hash(password, 10),
          api_key_hash: sha256(apiKey),
          landing_url,
          android_package,
          ios_app_id,
          deeplink_url,
          bonuses,
          approved,
        },
        select: { id: true, name: true, type: true, approved: true },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new BadRequestException('email already registered');
      throw e;
    }
    return {
      token: signSession({ org_id: org.id, type: asOrgType(org.type) }),
      org,
      // shown once — store it now; only a rotation can ever issue another
      api_key: apiKey,
      /** publishers only: until an admin approves, the org is hidden from the directory */
      approval_pending: !org.approved,
    };
  }

  /**
   * Complete an admin-issued password reset. The token arrives out of band (an admin generated
   * it via `POST /v1/admin/orgs/:id/reset-token` and relayed it over a channel they trust);
   * this endpoint is deliberately mailer-free — when an email sender exists, it calls the same
   * admin issuance and delivers the link itself.
   */
  @Post('reset')
  async reset(@Req() req: Request, @Body() b: { token: string; password: string }) {
    if (await rateLimited(`reset:${clientIp(req)}`, 10))
      throw new UnauthorizedException('too many attempts, try again shortly');
    const token = str(b.token, 'token', 128)!;
    const password = str(b.password, 'password', 200)!;
    if (password.length < 8) throw new BadRequestException('password min 8 chars');
    if (Buffer.byteLength(password) > MAX_PASSWORD)
      throw new BadRequestException(`password must be ${MAX_PASSWORD} bytes or fewer`);
    // Single-use: the same UPDATE that matches the token clears it, so a race between two
    // submissions of one token changes the password once.
    const updated = await prisma.org.updateMany({
      where: { reset_token_hash: sha256(token), reset_token_expires: { gt: new Date() } },
      data: {
        password_hash: await bcrypt.hash(password, 10),
        reset_token_hash: null,
        reset_token_expires: null,
      },
    });
    if (!updated.count) throw new UnauthorizedException('invalid or expired reset token');
    return { reset: true };
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

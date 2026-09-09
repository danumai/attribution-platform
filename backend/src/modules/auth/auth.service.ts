import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { toBonuses } from '../../common/dto/bonus.dto';
import { sha256 } from '../../common/security';
import { AUTO_APPROVE_PUBLISHERS } from '../../config';
import { PrismaService } from '../../config/prisma';
import { LoginDto } from './dto/login.dto';
import { ResetDto } from './dto/reset.dto';
import { SignupDto } from './dto/signup.dto';
import { asOrgType, newApiKey, signSession } from './tokens';

// Unmatchable real hash so no-such-account costs the same as wrong-password. Cost 10 matches signup.
const DUMMY_HASH = bcrypt.hashSync('unmatchable-placeholder-password', 10);

const BCRYPT_COST = 10;

@Injectable()
export class AuthService {
  constructor(private readonly db: PrismaService) {}

  async signup(dto: SignupDto) {
    // Both tenant types get a key: a publisher's answers "is this attributable", a promoter's mints
    // transaction codes on `/v1/issue`. Minted unconditionally so neither has to discover it lacks one.
    const apiKey = newApiKey();
    // Approval gates publishers only — they receive money. Promoters pay in, gated by their budget.
    const approved = dto.type === 'promoter' || AUTO_APPROVE_PUBLISHERS;
    let org;
    try {
      org = await this.db.org.create({
        data: {
          name: dto.name,
          type: dto.type,
          email: dto.email,
          password_hash: await bcrypt.hash(dto.password, BCRYPT_COST),
          api_key_hash: sha256(apiKey),
          landing_url: dto.landing_url ?? null,
          android_package: dto.android_package ?? null,
          ios_app_id: dto.ios_app_id ?? null,
          deeplink_url: dto.deeplink_url ?? null,
          bonuses: toBonuses(dto.bonuses),
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

  async reset(dto: ResetDto) {
    // Single-use: the UPDATE that matches the token also clears it, so a race applies once.
    const updated = await this.db.org.updateMany({
      where: { reset_token_hash: sha256(dto.token), reset_token_expires: { gt: new Date() } },
      data: {
        password_hash: await bcrypt.hash(dto.password, BCRYPT_COST),
        reset_token_hash: null,
        reset_token_expires: null,
      },
    });
    if (!updated.count) throw new UnauthorizedException('invalid or expired reset token');
    return { reset: true };
  }

  // Unvalidated by design (see LoginDto): coerced here so a wrong type looks like a wrong password.
  loginCredentials(dto: LoginDto) {
    return {
      email: typeof dto.email === 'string' ? dto.email.toLowerCase() : '',
      password: typeof dto.password === 'string' ? dto.password : '',
    };
  }

  async login(email: string, password: string) {
    const org = await this.db.org.findUnique({ where: { email } });
    // Hash even with no account: microseconds vs bcrypt's ~100ms is an account-existence oracle.
    const ok = await bcrypt.compare(password, org?.password_hash ?? DUMMY_HASH);
    if (!org || !ok) throw new UnauthorizedException('invalid credentials');
    if (org.suspended) throw new UnauthorizedException('account suspended');
    return {
      token: signSession({ org_id: org.id, type: asOrgType(org.type) }),
      org: { id: org.id, name: org.name, type: org.type },
    };
  }
}

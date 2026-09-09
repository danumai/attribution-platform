import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../config/prisma';
import { JWT_SECRET, SessionClaims, asOrgType } from './tokens';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(protected readonly db: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    let claims: SessionClaims;
    try {
      // Algorithm pinned, not inferred from the token's own header: the one input an attacker
      // controls must never name the scheme it is checked under.
      claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as SessionClaims;
    } catch {
      throw new UnauthorizedException();
    }
    // Instant revocation: suspending or offboarding a tenant must cut access now, not whenever its
    // 12h JWT expires. Costs one primary-key lookup per request.
    const org = await this.db.org.findUnique({
      where: { id: claims.org_id },
      select: { type: true, suspended: true },
    });
    if (!org || org.suspended) throw new UnauthorizedException('account suspended');
    // trust the DB over the token for role, so a demotion takes effect immediately too
    const session: SessionClaims = { org_id: claims.org_id, type: asOrgType(org.type) };
    req.session = session;
    return true;
  }
}

@Injectable()
export class AdminGuard extends AuthGuard {
  // Redeclared rather than inherited: TypeScript only emits `design:paramtypes` for a class that
  // writes its own constructor, and that metadata is the only thing telling Nest what to inject.
  // Omitting it leaves `this.db` undefined at the first request, not at boot.
  constructor(db: PrismaService) {
    super(db);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    await super.canActivate(ctx);
    if (ctx.switchToHttp().getRequest().session?.type !== 'admin')
      throw new ForbiddenException('super admin only');
    return true;
  }
}

export const Session = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SessionClaims =>
    ctx.switchToHttp().getRequest().session,
);

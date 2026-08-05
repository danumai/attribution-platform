import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { prisma } from '../../database/prisma';
import { JWT_SECRET, SessionClaims, asOrgType } from './tokens';

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    let claims: SessionClaims;
    try {
      // Algorithm pinned, not inferred from the token's own header — the one input an
      // attacker controls must never get to name the scheme it is checked under.
      claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as SessionClaims;
    } catch {
      throw new UnauthorizedException();
    }
    // Instant revocation: suspending or offboarding a tenant must cut access now, not whenever
    // its 12h JWT happens to expire. Costs one primary-key lookup per request.
    const org = await prisma.org.findUnique({
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

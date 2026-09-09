/**
 * `pk_…` API key authentication for the two server-to-server surfaces, which are opposites: a
 * publisher calls `/v1/attribution/*` and is paid, a promoter calls `/v1/issue` and pays.
 *
 * One function rather than two — the check is identical down to the per-key ceiling, and only the
 * required `type` differs. Two copies is two places to forget `suspended: false` in.
 */
import { UnauthorizedException } from '@nestjs/common';
import { rateLimited, sha256 } from '../../common/security';
import { prisma } from '../../config/prisma';
import type { OrgType } from '../auth/tokens';

interface KeyedOrg {
  id: string;
  name: string;
  /** raw JSONB — read through `bonusesFor`, which is what makes an odd row degrade to none */
  bonuses: unknown;
}

export async function orgFromKey(auth: string, type: OrgType): Promise<KeyedOrg> {
  const key = (auth ?? '').replace(/^Bearer /, '');
  if (!key.startsWith('pk_')) throw new UnauthorizedException('missing API key');
  const hash = sha256(key);
  // ponytail: in-process per-key ceiling, generous enough that no honest signup or issuance
  // flow hits it. Move to the shared Redis limiter when >1 instance runs, or it becomes N× this.
  if (await rateLimited(`partner:${hash}`, 600))
    throw new UnauthorizedException('rate limit exceeded, slow down');
  const org = await prisma.org.findFirst({
    // An API key never expires on its own, so `suspended` is the only thing that ends access: it
    // stops a publisher earning fees and a promoter minting codes, the moment it is set.
    where: { type, api_key_hash: hash, suspended: false },
    select: { id: true, name: true, bonuses: true },
  });
  if (!org) throw new UnauthorizedException('invalid API key');
  return org;
}

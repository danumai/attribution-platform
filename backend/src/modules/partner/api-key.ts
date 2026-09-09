/**
 * `pk_…` API key auth for both server-to-server surfaces: publishers (`/v1/attribution/*`, paid)
 * and promoters (`/v1/issue`, paying). One function — only `type` differs, and two copies would be
 * two places to forget `suspended: false`.
 */
import { UnauthorizedException } from '@nestjs/common';
import { rateLimited, sha256 } from '../../common/security';
import { prisma } from '../../config/prisma';
import type { OrgType } from '../auth/tokens';

interface KeyedOrg {
  id: string;
  name: string;
  /** raw JSONB — read via `bonusesFor`, which degrades an odd row to none */
  bonuses: unknown;
}

export async function orgFromKey(auth: string, type: OrgType): Promise<KeyedOrg> {
  const key = (auth ?? '').replace(/^Bearer /, '');
  if (!key.startsWith('pk_')) throw new UnauthorizedException('missing API key');
  const hash = sha256(key);
  // In-process per-key ceiling, above any honest flow. Move to the shared Redis limiter when >1
  // instance runs, or it becomes N× this.
  if (await rateLimited(`partner:${hash}`, 600))
    throw new UnauthorizedException('rate limit exceeded, slow down');
  const org = await prisma.org.findFirst({
    // Keys never expire, so `suspended` is the only thing that ends access — the moment it is set.
    where: { type, api_key_hash: hash, suspended: false },
    select: { id: true, name: true, bonuses: true },
  });
  if (!org) throw new UnauthorizedException('invalid API key');
  return org;
}

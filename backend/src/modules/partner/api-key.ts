/**
 * `pk_…` API key authentication, for the two server-to-server surfaces.
 *
 * There are now two kinds of machine caller, and they are opposites:
 *
 *   publisher   calls `/v1/attribution/*` to ask whether a signup or a purchase is
 *               attributable, and is *paid* when it is.
 *   promoter    calls `/v1/issue` to mint a code against a transaction it just took money
 *               for, and *pays* when that code is redeemed.
 *
 * One function rather than two because everything about the check is identical — the same hash,
 * the same suspension rule, the same per-key ceiling — and the only difference is which `type`
 * column the row must have. Two copies of an auth check is two places for the `suspended: false`
 * to be forgotten in.
 */
import { UnauthorizedException } from '@nestjs/common';
import { rateLimited, sha256 } from '../../common/security';
import { prisma } from '../../database/prisma';
import type { OrgType } from '../auth/tokens';

export interface KeyedOrg {
  id: string;
  name: string;
  bonus_label: string | null;
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
    // `suspended` matters here as much as it does at login. On the publisher side offboarding
    // has to stop its server earning fees immediately; on the promoter side it has to stop a
    // suspended brand minting codes that draw on a budget nobody is watching any more. An API
    // key never expires on its own, so this is the only thing that ends either.
    where: { type, api_key_hash: hash, suspended: false },
    select: { id: true, name: true, bonus_label: true },
  });
  if (!org) throw new UnauthorizedException('invalid API key');
  return org;
}

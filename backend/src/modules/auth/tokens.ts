import { randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';

const DEV_SECRET = 'dev-secret-change-me';

// A default signing secret in production is a total auth bypass — refuse to boot instead.
if (process.env.NODE_ENV === 'production' && (process.env.JWT_SECRET ?? DEV_SECRET) === DEV_SECRET)
  throw new Error('JWT_SECRET must be set to a non-default value in production');

// ponytail: HS256 shared secret; move to ES256 + KMS for production
export const JWT_SECRET = process.env.JWT_SECRET ?? DEV_SECRET;

/** The three roles, enforced by a CHECK on `orgs.type`. One definition, so a fourth role
 *  cannot be added to the union without every `switch` and validator here seeing it. */
export const ORG_TYPES = ['promoter', 'publisher', 'admin'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/** Narrow a role read out of the database. Throws rather than casting blind: an unknown
 *  value here means the CHECK constraint was bypassed, and a session must not be minted for it. */
export function asOrgType(type: string): OrgType {
  if (!(ORG_TYPES as readonly string[]).includes(type))
    throw new Error(`unknown org type: ${type}`);
  return type as OrgType;
}

export interface SessionClaims {
  org_id: string;
  type: OrgType;
}

export const signSession = (c: SessionClaims) =>
  jwt.sign(c, JWT_SECRET, { expiresIn: '12h' });

export const newApiKey = () => 'pk_' + randomBytes(24).toString('hex');

/**
 * Attribution claim id, carried in Play's install referrer. Deliberately not a signed token:
 * a token is a bearer credential the device could spend, and the whole point of this design
 * is that nothing reaching the phone is spendable. This is an opaque lookup key whose only
 * power is to name a scan the publisher's *server* must then claim with its API key.
 * base64url so it survives a referrer string without escaping.
 */
export const newClaimId = () => randomBytes(16).toString('base64url'); // 128 bits
export const newShortCode = () => randomBytes(12).toString('base64url'); // 96 bits — not guessable

import { randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';

const DEV_SECRET = 'dev-secret-change-me';

// A default signing secret in production is a total auth bypass — refuse to boot instead.
if (process.env.NODE_ENV === 'production' && (process.env.JWT_SECRET ?? DEV_SECRET) === DEV_SECRET)
  throw new Error('JWT_SECRET must be set to a non-default value in production');

// ponytail: HS256 shared secret; move to ES256 + KMS for production
export const JWT_SECRET = process.env.JWT_SECRET ?? DEV_SECRET;

export interface SessionClaims {
  org_id: string;
  type: 'promoter' | 'publisher' | 'admin';
}

export const signSession = (c: SessionClaims) =>
  jwt.sign(c, JWT_SECRET, { expiresIn: '12h' });

export const signScanToken = (c: { scan_id: string; campaign_id: string }) =>
  jwt.sign({ ...c, kind: 'scan' }, JWT_SECRET, { expiresIn: '15m' });

export const newApiKey = () => 'pk_' + randomBytes(24).toString('hex');
export const newShortCode = () => randomBytes(12).toString('base64url'); // 96 bits — not guessable

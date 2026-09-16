import { cookies } from 'next/headers';
import type { OrgType } from './types';

export interface Session {
  token: string;
  org: { id: string; name: string; type: OrgType };
}

export function getSession(): Session | null {
  const store = cookies();
  const token = store.get('token')?.value;
  const orgRaw = store.get('org')?.value;
  if (!token || !orgRaw) return null;
  try {
    return { token, org: JSON.parse(orgRaw) };
  } catch {
    return null;
  }
}

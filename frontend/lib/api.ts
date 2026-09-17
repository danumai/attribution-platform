// Baked in at build time — set NEXT_PUBLIC_API_URL before `next build`, not at runtime.
export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Accepted tradeoff: the backend is cross-origin with no same-origin proxy yet, so the bearer
 *  token lives in localStorage rather than an httpOnly cookie. An XSS on this app can still read
 *  it — the httpOnly session cookie added for server-rendered pages (see `lib/session.ts`) does
 *  not close this gap for client-side requests that still go through `api()`. */
export function token() {
  return typeof window === 'undefined' ? null : localStorage.getItem('token');
}

export function org(): {
  id: string;
  name: string;
  type: 'promoter' | 'publisher' | 'admin';
} | null {
  if (typeof window === 'undefined') return null;
  const o = localStorage.getItem('org');
  return o ? JSON.parse(o) : null;
}

/**
 * One fetch wrapper for the whole console. `T` is an assertion, not a validation — nothing checks
 * the body against the shape asked for.
 */
export async function api<T = void>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
  return body as T;
}

// Baked in at build time — set NEXT_PUBLIC_API_URL before `next build`, not at runtime.
export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
 * One fetch wrapper for the whole console.
 *
 * `T` is an assertion, not a validation — nothing here checks the body against the shape the
 * caller asked for. That is deliberate: the alternative is a schema library on every one of
 * ~25 call sites to catch a class of bug the e2e suite already catches against the real
 * server. What the generic buys is that the console stays consistent *with itself*, so a
 * field renamed in `lib/types.ts` fails the build instead of rendering blank.
 *
 * Callers that genuinely ignore the body leave `T` as `void`.
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

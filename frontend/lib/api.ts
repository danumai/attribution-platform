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

export async function api(path: string, opts: RequestInit = {}) {
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
  return body;
}

import { redirect } from 'next/navigation';
import { getSession } from './session';

const API = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiServer<T = void>(path: string, opts: RequestInit = {}): Promise<T> {
  const session = getSession();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.message ?? `HTTP ${res.status}`);
  return body as T;
}

/** Wrap a dashboard page's data-fetching in this. A 401 (stale cookie, expired or invalid
 *  token — regardless of why) redirects to /login cleanly instead of crashing. Any other
 *  error is rethrown as-is, for error.tsx to handle generically. */
export async function withAuthRedirect<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login');
    throw e;
  }
}

/** Digest stamped on errors thrown when the API can't be reached at all (connection refused,
 *  DNS failure, …). Next keeps a pre-set `digest` and forwards it to error.tsx even in
 *  production, where the message itself is withheld — so this is the only reliable signal.
 *  Kept out of apiServer.ts because error boundaries are client components. */
export const API_UNREACHABLE = 'API_UNREACHABLE';

export function isApiUnreachable(error: Error & { digest?: string }): boolean {
  return error.digest === API_UNREACHABLE;
}

export const API_UNREACHABLE_MESSAGE =
  'The server is not responding right now. It may be restarting — try again in a moment.';

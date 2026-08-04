/**
 * The row ceiling every list endpoint answers under.
 *
 * Clamped at both ends: Prisma reads a negative `take` as "last N, reversed", so `?limit=-5`
 * silently returned the oldest rows from a newest-first endpoint.
 *
 * Shared rather than per-controller because the failure mode is an endpoint that quietly
 * has no ceiling at all — which is exactly what happened to six of them while three siblings
 * were capped.
 */
export const capped = (limit?: string) =>
  Math.min(Math.max(Math.trunc(+(limit ?? 200)) || 200, 1), 1000);

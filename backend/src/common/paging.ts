/** Shared row ceiling for list endpoints, clamped at both ends: Prisma reads a negative `take` as
 *  "last N, reversed", so `?limit=-5` returned the oldest rows from a newest-first endpoint. */
export const capped = (limit?: string) =>
  Math.min(Math.max(Math.trunc(+(limit ?? 200)) || 200, 1), 1000);

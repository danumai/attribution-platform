/**
 * The row ceiling every list endpoint answers under. Clamped at both ends: Prisma reads a
 * negative `take` as "last N, reversed", so `?limit=-5` silently returned the oldest rows from a
 * newest-first endpoint. Shared so a new endpoint cannot ship with no ceiling at all.
 */
export const capped = (limit?: string) =>
  Math.min(Math.max(Math.trunc(+(limit ?? 200)) || 200, 1), 1000);

import type { MetadataRoute } from 'next';

// Mirrors FRONTEND_URL's dev default (backend/.env.example) — there is no frontend-exposed
// site URL env var yet. Point this at the real production origin (ideally via a
// NEXT_PUBLIC_SITE_URL) before this ships.
const SITE_URL = 'http://localhost:3000';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, lastModified: new Date() }];
}

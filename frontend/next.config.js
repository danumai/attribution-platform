/**
 * The API sets its own headers (see backend/src/common/security.ts). Next served none at all,
 * so every console page — the ones holding a session token and a publisher API key in
 * localStorage — was framable and sniffable.
 *
 * No CSP here on purpose: Next's App Router injects inline bootstrap scripts, so a useful
 * policy needs per-request nonces via middleware. Clickjacking and sniffing are the two that
 * matter for a token-in-localStorage console, and both are one header each.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

module.exports = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

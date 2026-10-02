import type { NextConfig } from 'next';

// Trailing slashes are trimmed so "https://x.com/" doesn't become "//api/...".
const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  // The browser only ever talks to this site. /api/* is forwarded to NestJS,
  // which keeps the login cookie first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;

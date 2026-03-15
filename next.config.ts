import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/dashboard',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          // Vercel replaces this with HIT/MISS/BYPASS/STALE automatically.
          // In dev you'll see BYPASS; in production watch for HIT (served from edge).
          { key: 'X-Cache-Status', value: 'BYPASS' },
        ],
      },
      {
        // API routes — mark them so you can inspect cache behavior in DevTools
        source: '/api/:path*',
        headers: [
          { key: 'X-Cache-Status', value: 'BYPASS' },
        ],
      },
    ];
  },
};

export default nextConfig;

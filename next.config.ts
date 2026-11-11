import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-hosted in Docker on a Vietnam-based cloud (ADR-0012).
  output: 'standalone',
  // Cache Components: 'use cache' + cacheTag for catalogue pages (ARCHITECTURE.md §14.1).
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  typedRoutes: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;

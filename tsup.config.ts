import { defineConfig } from 'tsup';

/**
 * Worker bundle (ADR-0023). App code (`@/…`, worker/) is bundled; node_modules stay external
 * and are resolved by Node at runtime with the default conditions.
 *
 * The `react-server` condition is deliberately NOT used: it makes `react-dom/server` throw
 * (React Email cannot render) and switches next-intl to its RSC build, which imports
 * `next/headers`. Code shared with the worker must not import Next.js runtime APIs or
 * `server-only` (ESLint enforces this); as a safety net `server-only` is aliased to a no-op.
 */
export default defineConfig({
  entry: { index: 'worker/index.ts', migrate: 'worker/migrate.ts', seed: 'worker/seed.ts' },
  outDir: 'dist/worker',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: false,
  dts: false,
  noExternal: ['server-only'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
    options.alias = { ...options.alias, 'server-only': './worker/server-only-noop.ts' };
  },
});

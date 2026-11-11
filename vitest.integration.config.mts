import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests against a real PostgreSQL.
 * Uses TEST_DATABASE_URL when set (CI service container); otherwise starts postgres:17
 * with Testcontainers (requires Docker).
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});

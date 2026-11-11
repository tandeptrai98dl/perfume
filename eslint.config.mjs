import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/** Module boundaries from docs/ARCHITECTURE.md §9 (import rules). */
const moduleInternals = {
  group: ['@/server/modules/*/repo', '@/server/modules/*/service', '@/server/modules/*/repo.*'],
  message: "Import a module through its public index.ts (e.g. '@/server/modules/catalog').",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // UI code never reaches into server code.
    files: ['src/components/**', 'src/hooks/**', 'src/stores/**', 'src/lib/**'],
    ignores: ['src/lib/env.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/server/*'], message: 'Client-side code must not import server code.' },
          ],
        },
      ],
    },
  },
  {
    // Routing and Server Actions call modules only through their public API.
    files: ['src/app/**', 'src/actions/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [moduleInternals] }] },
  },
  {
    // Shared with the worker: `server-only` would throw outside Next.js.
    files: [
      'src/server/modules/**',
      'src/server/jobs/**',
      'src/server/integrations/**',
      'src/server/db/**',
      'src/server/lib/**',
      'worker/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'server-only',
              message:
                'The worker shares this code; use server-only only in actions/ and server/auth/.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'dist/**', 'next-env.d.ts']),
]);

export default eslintConfig;

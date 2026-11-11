import { describe, expect, it } from 'vitest';

import { EnvValidationError, parseClientEnv, parseServerEnv } from './env';

describe('parseServerEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    const env = parseServerEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_URL).toBe('http://localhost:3000');
  });

  it('rejects an invalid APP_URL with a readable message', () => {
    expect(() => parseServerEnv({ APP_URL: 'not-a-url' })).toThrow(EnvValidationError);
    try {
      parseServerEnv({ APP_URL: 'not-a-url' });
    } catch (error) {
      expect((error as EnvValidationError).issues[0]).toMatch(/^APP_URL:/);
    }
  });
});

describe('parseClientEnv', () => {
  it('uses the default app name', () => {
    expect(parseClientEnv({}).NEXT_PUBLIC_APP_NAME).toBe('Perfume Store');
  });
});

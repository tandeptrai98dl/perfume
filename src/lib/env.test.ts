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

  it('treats empty values as unset', () => {
    const env = parseServerEnv({ BETTER_AUTH_SECRET: '', GOOGLE_CLIENT_ID: '' });
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('requires a real BETTER_AUTH_SECRET in production', () => {
    expect(() => parseServerEnv({ NODE_ENV: 'production' })).toThrow(/BETTER_AUTH_SECRET/);
    const secret = 'x'.repeat(32);
    expect(
      parseServerEnv({ NODE_ENV: 'production', BETTER_AUTH_SECRET: secret }).BETTER_AUTH_SECRET,
    ).toBe(secret);
  });

  it('requires the Google client id and secret together', () => {
    expect(() => parseServerEnv({ GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });
});

describe('parseClientEnv', () => {
  it('uses the default app name', () => {
    expect(parseClientEnv({}).NEXT_PUBLIC_APP_NAME).toBe('Perfume Store');
  });
});

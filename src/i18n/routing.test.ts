import { afterEach, describe, expect, it, vi } from 'vitest';

/* §12 cookie flags: the NEXT_LOCALE cookie is Secure in production builds, Lax always. */

async function load() {
  vi.resetModules();
  return (await import('./routing')).routing;
}

afterEach(() => vi.unstubAllEnvs());

describe('locale cookie', () => {
  it('is Secure in production builds', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    // next-intl adds its defaults (name NEXT_LOCALE, sameSite lax) to these attributes.
    expect((await load()).localeCookie).toMatchObject({ secure: true });
  });

  it('is not Secure in development (plain-http LAN hosts)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect((await load()).localeCookie).toMatchObject({ secure: false });
  });
});

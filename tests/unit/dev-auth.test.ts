import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe('dev auth', () => {
  it('does nothing without the flag', async () => {
    const { installDevAuth } = await import('@/lib/dev-auth');
    expect(() => installDevAuth()).not.toThrow();
  });
  it('is refused in production', async () => {
    vi.stubEnv('ML_DEV_AUTH', '1'); vi.stubEnv('NODE_ENV', 'production');
    const { installDevAuth } = await import('@/lib/dev-auth');
    expect(() => installDevAuth()).toThrow(/production/);
  });
  it('needs a user id, then installs the resolver', async () => {
    vi.stubEnv('ML_DEV_AUTH', '1'); vi.stubEnv('NODE_ENV', 'development');
    const { installDevAuth } = await import('@/lib/dev-auth');
    expect(() => installDevAuth()).toThrow(/ML_DEV_USER_ID/);
    vi.stubEnv('ML_DEV_USER_ID', 'u-1');
    installDevAuth();
    const { getSessionUser } = await import('@/lib/http/ctx');
    expect(await getSessionUser(new Request('http://x'))).toBe('u-1');
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { api, world } from './helpers/world';
import { runIntegration } from './helpers/gate';
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { if (runIntegration) W = await world(); });

describe.runIf(runIntegration)('A9 profile & preferences (/api/v1/me)', () => {
  it('defaults: theme system, name derived from email', async () => {
    const r = await (await api(W.G1, 'GET', '/api/v1/me')).json();
    expect(r.theme).toBe('system');
    expect(r.display_name).toBeNull();
    expect(r.name).toBeTruthy();
  });
  it('PATCH persists display name, avatar and theme, and sets the theme cookie', async () => {
    const r = await api(W.M1, 'PATCH', '/api/v1/me', { display_name: '  Ada L  ', avatar_url: 'https://example.test/a.png', theme: 'light' });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie') ?? '').toMatch(/ml_theme=light/);
    const me = await (await api(W.M1, 'GET', '/api/v1/me')).json();
    expect(me).toMatchObject({ display_name: 'Ada L', name: 'Ada L', avatar_url: 'https://example.test/a.png', theme: 'light' });
    const cleared = await (await api(W.M1, 'PATCH', '/api/v1/me', { display_name: null, theme: 'dark' })).json();
    expect(cleared).toMatchObject({ display_name: null, avatar_url: 'https://example.test/a.png', theme: 'dark' });
  });
  it('rejects bad input: unknown theme, non-https avatar, empty/long name, unknown keys', async () => {
    for (const b of [{ theme: 'neon' }, { avatar_url: 'javascript:alert(1)' }, { avatar_url: 'http://x.test/a.png' }, { display_name: '   ' }, { display_name: 'x'.repeat(81) }, { email: 'evil@example.test' }, { id: 'x' }]) {
      const s = (await api(W.M1, 'PATCH', '/api/v1/me', b)).status;
      expect(s, JSON.stringify(b)).toBeGreaterThanOrEqual(400);
      expect(s).toBeLessThan(500);
    }
  });
  it('anonymous PATCH is 401', async () => {
    expect((await api(null, 'PATCH', '/api/v1/me', { theme: 'dark' })).status).toBe(401);
  });
});

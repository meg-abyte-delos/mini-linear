import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ownerSql, seedTwoWorkspaces, type Seed } from '../helpers/seed';
import { db, setSessionResolver } from '../../src/lib/http/ctx';
import { getLogo, uploadLogo } from '../../src/lib/resources/workspace-logo';
import { getWorkspaceSettings, patchWorkspaceSettings } from '../../src/lib/resources/tenancy';

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error('CI=true but DB urls unset: integration tests must not skip');

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], JPG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0)));
const bytes = (magic: number[], total = 64) => { const b = new Uint8Array(total); b.set(magic); for (let i = magic.length; i < total; i++) b[i] = i % 251; return b; };

// POST/GET /w/:slug/settings/logo: admin/owner upload, member read; type from magic bytes; 1 MiB cap; external https URL still accepted on PATCH.
(haveDb ? describe : describe.skip)('workspace logo upload', () => {
  const owner = ownerSql(); let seed: Seed; let current = '';
  const form = (data: Uint8Array | string, name = 'logo.png', type = 'image/png', field = 'file') => { const f = new FormData(); f.set(field, new Blob([data as BlobPart], { type }), name); return f; };
  const post = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request('http://x/api', { method: 'POST', headers: { origin: 'http://x', host: 'x', ...headers }, body });
  const upload = (data: Uint8Array | string, name?: string, type?: string, slug = seed.a.slug) => uploadLogo(post(form(data, name, type)), slug);
  const get = (slug = seed.a.slug, h: Record<string, string> = {}) => getLogo(new Request('http://x/api', { headers: { host: 'x', ...h } }), slug);
  const settings = async () => (await getWorkspaceSettings(new Request('http://x/api'), seed.a.slug)).json() as Promise<{ logo_url: string | null; slug: string }>;
  const patch = (b: unknown) => patchWorkspaceSettings(new Request('http://x/api', { method: 'PATCH', headers: { origin: 'http://x', host: 'x', 'content-type': 'application/json' }, body: JSON.stringify(b) }), seed.a.slug);
  beforeAll(async () => { seed = await seedTwoWorkspaces(owner); setSessionResolver(async () => current); });
  afterAll(async () => { await db().end(); await owner.end(); });

  it('permissions: member and guest 403, non-member 404, anonymous 401; nothing stored', async () => {
    for (const u of [seed.a.member, seed.a.guest]) { current = u; expect((await upload(bytes(PNG))).status, u).toBe(403); }
    current = seed.b.owner; expect((await upload(bytes(PNG))).status).toBe(404);
    current = ''; expect((await upload(bytes(PNG))).status).toBe(401);
    current = seed.a.owner; expect((await get()).status).toBe(404);
  });
  it('admin uploads a png: 201, relative logo_url, members read the same bytes with safe headers', async () => {
    current = seed.a.admin;
    const png = bytes(PNG, 200), r = await upload(png);
    expect(r.status).toBe(201);
    const body = await r.json() as { logo_url: string };
    expect(body.logo_url).toMatch(new RegExp(`^/api/v1/w/${seed.a.slug}/settings/logo\\?v=[0-9a-f]{16}$`));
    current = seed.a.guest;
    const g = await get();
    expect(g.status).toBe(200);
    expect(g.headers.get('content-type')).toBe('image/png');
    expect(g.headers.get('x-content-type-options')).toBe('nosniff');
    expect(g.headers.get('content-security-policy')).toBe('sandbox');
    expect(new Uint8Array(await g.arrayBuffer())).toEqual(png);
    expect((await get(seed.a.slug, { 'if-none-match': g.headers.get('etag')! })).status).toBe(304);
    expect((await settings()).logo_url).toBe(body.logo_url);
    current = seed.b.owner; expect((await get(seed.a.slug)).status).toBe(404); // other tenant
  });
  it('replacing with jpeg and webp works (type detected from content, ignoring declared type and name)', async () => {
    current = seed.a.owner;
    expect((await upload(bytes(JPG), 'x.bin', 'application/octet-stream')).status).toBe(201);
    expect((await get()).headers.get('content-type')).toBe('image/jpeg');
    expect((await upload(bytes(WEBP), 'x.png', 'image/png')).status).toBe(201);
    expect((await get()).headers.get('content-type')).toBe('image/webp');
  });
  it('rejects a text file renamed .png (magic bytes) with 415, plus gif, svg and html; the stored logo is unchanged', async () => {
    current = seed.a.owner;
    const before = (await settings()).logo_url;
    for (const [d, n, t] of [['hello, not an image', 'logo.png', 'image/png'], ['GIF89a....', 'a.gif', 'image/gif'], ['<svg xmlns="http://www.w3.org/2000/svg"/>', 'a.svg', 'image/svg+xml'], ['<html><script>alert(1)</script>', 'a.png', 'image/png']] as const)
      expect((await upload(d, n, t)).status, n).toBe(415);
    expect((await settings()).logo_url).toBe(before);
  });
  it('rejects a file over 1 MiB with 413 and accepts exactly 1 MiB', async () => {
    current = seed.a.owner;
    expect((await upload(bytes(PNG, 1024 * 1024 + 1))).status).toBe(413);
    expect((await upload(bytes(PNG, 3 * 1024 * 1024))).status).toBe(413);
    expect((await upload(bytes(PNG, 1024 * 1024))).status).toBe(201);
  });
  it('rejects a non-multipart body (415), a missing file part (400), an empty file (400)', async () => {
    current = seed.a.owner;
    expect((await uploadLogo(post(bytes(PNG) as BodyInit, { 'content-type': 'image/png' }), seed.a.slug)).status).toBe(415);
    expect((await uploadLogo(post(form(bytes(PNG), 'a.png', 'image/png', 'other')), seed.a.slug)).status).toBe(400);
    expect((await upload(new Uint8Array(0))).status).toBe(400);
  });
  it('PATCH keeps accepting an external https logo (and clears the upload); an internal marker or http is refused', async () => {
    current = seed.a.owner;
    expect((await upload(bytes(PNG))).status).toBe(201);
    for (const v of ['logo:0123456789abcdef', 'http://x.test/a.png', '/api/v1/w/x/settings/logo']) expect((await patch({ logo_url: v })).status, v).toBeGreaterThanOrEqual(400);
    const r = await patch({ logo_url: 'https://cdn.example.test/logo.png' });
    expect(r.status).toBe(200);
    expect((await r.json() as { logo_url: string }).logo_url).toBe('https://cdn.example.test/logo.png');
    expect((await get()).status).toBe(404);
    expect((await upload(bytes(PNG))).status).toBe(201);
    expect((await (await patch({ name: 'Renamed' })).json() as { logo_url: string }).logo_url).toMatch(/\/settings\/logo\?v=/); // other fields keep the upload
    expect((await patch({ logo_url: '' })).status).toBe(200);
    expect((await get()).status).toBe(404);
    expect((await settings()).logo_url).toBeNull();
  });
  it('the logo survives a slug rename (the url follows the new slug)', async () => {
    current = seed.a.owner;
    expect((await upload(bytes(PNG))).status).toBe(201);
    const ns = seed.a.slug + '-new';
    expect((await patch({ slug: ns })).status).toBe(200);
    const s = await (await getWorkspaceSettings(new Request('http://x/api'), ns)).json() as { logo_url: string };
    expect(s.logo_url).toMatch(new RegExp(`^/api/v1/w/${ns}/settings/logo\\?v=`));
    expect((await get(ns)).status).toBe(200);
  });
});

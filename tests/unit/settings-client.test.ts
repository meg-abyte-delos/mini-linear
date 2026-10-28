import { describe, it, expect, vi } from 'vitest';
import { settingsPatch, suggestKey, patchSettings, addTeamMember, SettingsError, removeTeamMember } from '../../src/lib/settings-client';

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('settingsPatch', () => {
  const prev = { name: 'Acme', slug: 'acme', logo_url: null };
  it('sends nothing when unchanged', () => expect(settingsPatch(prev, { name: 'Acme ', slug: 'acme', logo_url: '' })).toEqual({}));
  it('sends only changed fields, trimmed', () => expect(settingsPatch(prev, { name: ' New ', slug: 'acme', logo_url: 'https://x.test/l.png' })).toEqual({ name: 'New', logo_url: 'https://x.test/l.png' }));
  it('clearing a logo sends an empty string', () => expect(settingsPatch({ ...prev, logo_url: 'https://a.test/l.png' }, { name: 'Acme', slug: 'acme', logo_url: '' })).toEqual({ logo_url: '' }));
});

describe('suggestKey', () => {
  it.each([['Engineering', 'ENGIN'], ['Mobile Platform Team', 'MPT'], ['Ops', 'OPS'], ['Q', 'QX'], ['Équipe données', 'ED']])('%s -> %s', (n, k) => {
    expect(suggestKey(n)).toBe(k);
    expect(suggestKey(n)).toMatch(/^[A-Z]{2,5}$/);
  });
});

describe('http calls', () => {
  it('PATCH settings with JSON body', async () => {
    const f = vi.fn(async () => res(200, { id: '1', slug: 'b', name: 'B', logo_url: null, role: 'admin' }));
    await patchSettings('a b', { slug: 'b' }, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith('/api/v1/w/a%20b/settings', expect.objectContaining({ method: 'PATCH', body: '{"slug":"b"}' }));
  });
  it('maps API errors to SettingsError with status and message', async () => {
    const f = vi.fn(async () => res(403, { error: { code: 'forbidden', message: 'read-only on this team' } }));
    await expect(addTeamMember('w', 't', 'u', 'admin', f as unknown as typeof fetch)).rejects.toEqual(expect.objectContaining({ status: 403, message: 'read-only on this team' }));
    await expect(addTeamMember('w', 't', 'u', 'admin', f as unknown as typeof fetch)).rejects.toBeInstanceOf(SettingsError);
  });
  it('204 resolves to undefined', async () => {
    const f = vi.fn(async () => res(204));
    await expect(removeTeamMember('w', 't', 'u', f as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});

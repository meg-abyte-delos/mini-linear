import { describe, it, expect, vi } from 'vitest';
import { settingsPatch, suggestKey, patchSettings, addTeamMember, SettingsError, removeTeamMember, assignableRoles, canManageMember } from '../../src/lib/settings-client';

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

import { createInvite, setMemberRole, listAllMembers, matchesMember, revokeInvite } from '../../src/lib/settings-client';
describe('members + invites calls', () => {
  it('createInvite lowercases and trims the email', async () => {
    const f = vi.fn(async () => res(201, { id: 'i', email: 'a@b.test', role: 'member' }));
    await createInvite('w', ' A@B.test ', 'member', f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith('/api/v1/w/w/invites', expect.objectContaining({ method: 'POST', body: '{"email":"a@b.test","role":"member"}' }));
  });
  it('setMemberRole PATCHes the role; revokeInvite DELETEs', async () => {
    const f = vi.fn(async () => res(204));
    await setMemberRole('w', 'u1', 'admin', f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith('/api/v1/w/w/members/u1', expect.objectContaining({ method: 'PATCH', body: '{"role":"admin"}' }));
    await revokeInvite('w', 'i1', f as unknown as typeof fetch);
    expect(f).toHaveBeenLastCalledWith('/api/v1/w/w/invites/i1', expect.objectContaining({ method: 'DELETE' }));
  });
  it('listAllMembers follows next_cursor', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(200, { items: [{ user_id: '1', email: 'a@x.test', role: 'owner' }], next_cursor: 'c 1' }))
      .mockResolvedValueOnce(res(200, { items: [{ user_id: '2', email: 'b@x.test', role: 'member' }], next_cursor: null }));
    const rows = await listAllMembers('w', f as unknown as typeof fetch);
    expect(rows.map((r) => r.user_id)).toEqual(['1', '2']);
    expect(f.mock.calls[1]![0]).toContain('cursor=c%201');
  });
  it('matchesMember filters on name or email, ignoring case', () => {
    expect(matchesMember({ email: 'Mate@x.test' }, 'Mate', 'MAT')).toBe(true);
    expect(matchesMember({ email: 'a@x.test' }, 'Ada', 'zz')).toBe(false);
    expect(matchesMember({ email: 'a@x.test' }, 'Ada', '  ')).toBe(true);
  });
});

describe('role rules (Members UI)', () => {
  it('never offers owner, and admin only to an owner', () => {
    expect(assignableRoles('owner')).toEqual(['admin', 'member', 'guest']);
    expect(assignableRoles('admin')).toEqual(['member', 'guest']);
    expect(assignableRoles('member')).toEqual([]);
    for (const v of ['owner', 'admin', 'member', 'guest', undefined]) expect(assignableRoles(v)).not.toContain('owner');
  });
  it('owner rows are untouchable; admin peers only for an owner', () => {
    expect(canManageMember('owner', 'owner')).toBe(false);
    expect(canManageMember('admin', 'owner')).toBe(false);
    expect(canManageMember('admin', 'admin')).toBe(false);
    expect(canManageMember('owner', 'admin')).toBe(true);
    expect(canManageMember('admin', 'member')).toBe(true);
    expect(canManageMember('member', 'guest')).toBe(false);
  });
});

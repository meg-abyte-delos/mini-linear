import { describe, it, expect, vi, beforeEach } from 'vitest';

const ws = vi.fn(), teams = vi.fn(), redirect = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
vi.mock('@/lib/resources/tenancy', () => ({ listWorkspaces: (...a: unknown[]) => ws(...a), listTeams: (...a: unknown[]) => teams(...a) }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ toString: () => 'ml_session=tok' }) }));
vi.mock('@/lib/dev-auth', () => ({ installDevAuth: () => {} }));

import { pickWorkspace, getWorkspaceContext } from '@/lib/auth/workspace-context';

const ok = (items: unknown[]) => new Response(JSON.stringify({ items }), { status: 200 });
const status = (s: number) => new Response('{}', { status: s });

describe('pickWorkspace', () => {
  const a = { id: '1', slug: 'acme' }, d = { id: '2', slug: 'demo' };
  it('prefers demo when the user is a member', () => expect(pickWorkspace([a, d])).toBe(d));
  it('falls back to the first membership, never to a workspace the user is not in', () => expect(pickWorkspace([a])).toBe(a));
  it('returns null without memberships', () => expect(pickWorkspace([])).toBeNull());
});

describe('getWorkspaceContext', () => {
  beforeEach(() => { ws.mockReset(); teams.mockReset(); redirect.mockClear(); });
  it('returns slug and first team, forwarding the session cookie', async () => {
    ws.mockResolvedValue(ok([{ id: '1', slug: 'acme' }, { id: '2', slug: 'demo' }]));
    teams.mockResolvedValue(ok([{ id: 't1' }, { id: 't2' }]));
    await expect(getWorkspaceContext()).resolves.toEqual({ slug: 'demo', teamId: 't1' });
    expect((ws.mock.calls[0]![0] as Request).headers.get('cookie')).toBe('ml_session=tok');
    expect(teams.mock.calls[0]![1]).toBe('demo');
  });
  it('redirects to /login on 401, no fallback', async () => {
    ws.mockResolvedValue(status(401));
    await expect(getWorkspaceContext()).rejects.toThrow('REDIRECT:/login');
    expect(teams).not.toHaveBeenCalled();
  });
  it('throws (no redirect) when the user has no workspace', async () => {
    ws.mockResolvedValue(ok([]));
    await expect(getWorkspaceContext()).rejects.toThrow(/no workspace/);
    expect(redirect).not.toHaveBeenCalled();
  });
  it('throws when the workspace has no team', async () => {
    ws.mockResolvedValue(ok([{ id: '2', slug: 'demo' }]));
    teams.mockResolvedValue(ok([]));
    await expect(getWorkspaceContext()).rejects.toThrow(/no team/);
  });
  it('surfaces non-401 failures', async () => {
    ws.mockResolvedValue(status(500));
    await expect(getWorkspaceContext()).rejects.toThrow(/500/);
    expect(redirect).not.toHaveBeenCalled();
  });
});

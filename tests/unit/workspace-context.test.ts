import { describe, it, expect } from 'vitest';
import { pickWorkspace } from '@/lib/auth/workspace-context';

describe('pickWorkspace', () => {
  const a = { id: '1', slug: 'acme' }, d = { id: '2', slug: 'demo' };
  it('prefers demo when the user is a member', () => expect(pickWorkspace([a, d])).toBe(d));
  it('falls back to the first membership, never to a workspace the user is not in', () => expect(pickWorkspace([a])).toBe(a));
  it('returns null without memberships', () => expect(pickWorkspace([])).toBeNull());
});

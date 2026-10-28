import { describe, it, expect } from 'vitest';
import { loadViewer, type ApiConfig } from '@/lib/remote';

describe('loadViewer fails closed', () => {
  it('returns guest with no user id when the workspace lookup throws', async () => {
    const v = await loadViewer({ slug: 'nope', teamId: 't' } as ApiConfig);
    expect(v).toEqual({ userId: null, role: 'guest' });
  });
});

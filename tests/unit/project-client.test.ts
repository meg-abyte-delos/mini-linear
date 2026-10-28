import { describe, it, expect } from 'vitest';
import { projectClient, newestFirst, byTarget, type Milestone, type ProjectUpdate } from '../../src/lib/project-client';

const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
describe('project client', () => {
  it('hits the #67 endpoints with the right shapes', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const f = (async (u: string, init?: RequestInit) => { calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body as string | undefined }); return res(u.includes('/milestones') && !init ? { items: [] } : u.includes('/updates') && !init ? { items: [] } : { id: 'x' }, init ? 201 : 200); }) as unknown as typeof fetch;
    const c = projectClient('w', 'p1', f);
    await c.get(); await c.milestones(); await c.updates(); await c.addUpdate('at_risk', 'hi'); await c.addMilestone('M1', '2026-12-01');
    expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([
      'GET /api/v1/w/w/projects/p1', 'GET /api/v1/w/w/projects/p1/milestones?limit=100', 'GET /api/v1/w/w/projects/p1/updates?limit=100',
      'POST /api/v1/w/w/projects/p1/updates', 'POST /api/v1/w/w/projects/p1/milestones']);
    expect(JSON.parse(calls[3]!.body!)).toEqual({ health: 'at_risk', body: 'hi' });
    expect(JSON.parse(calls[4]!.body!)).toEqual({ name: 'M1', description: '', target_date: '2026-12-01', sort_order: 0 });
  });
  it('throws on HTTP errors', async () => {
    const f = (async () => res({}, 404)) as unknown as typeof fetch;
    await expect(projectClient('w', 'p', f).get()).rejects.toThrow('HTTP 404');
  });
  it('sorts updates newest first and milestones by target date', () => {
    const u = [{ id: 'a', created_at: '2026-10-01' }, { id: 'b', created_at: '2026-10-03' }] as ProjectUpdate[];
    expect(newestFirst(u).map((x) => x.id)).toEqual(['b', 'a']);
    const m = [{ id: '1', target_date: null, sort_order: 0 }, { id: '2', target_date: '2026-11-01', sort_order: 0 }, { id: '3', target_date: '2026-10-01', sort_order: 0 }] as Milestone[];
    expect(byTarget(m).map((x) => x.id)).toEqual(['3', '2', '1']);
  });
});
describe('project patch', () => {
  it('sends PATCH with If-Match version', async () => {
    let seen: RequestInit | undefined;
    const f = (async (_u: string, init?: RequestInit) => { seen = init; return res({ id: 'p1' }); }) as unknown as typeof fetch;
    await projectClient('w', 'p1', f).patch(3, { status: 'paused' });
    expect(seen?.method).toBe('PATCH');
    expect((seen?.headers as Record<string, string>)['if-match']).toBe('"3"');
    expect(JSON.parse(seen?.body as string)).toEqual({ status: 'paused' });
  });
});

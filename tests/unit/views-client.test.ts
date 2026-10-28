import { describe, expect, it } from 'vitest';
import { emptyFilters, applyFilters, parseFilters } from '@/lib/filters';
import { filtersToGroup, groupToFilters, httpViewsClient, mockViewsClient, viewUrl, type SavedView } from '@/lib/views-client';
import { seedIssues } from '@/lib/issues';

describe('filters <-> saved view group', () => {
  it('round-trips every dimension, including priority', () => {
    const f = { ...emptyFilters(), status: ['todo'], priority: ['1', '2'], assignee: ['none'], label: ['l1'], project: ['p1'], cycle: ['c1'] };
    const g = filtersToGroup(f);
    expect(g.op).toBe('and');
    expect(g.rules).toHaveLength(6);
    expect(groupToFilters(g)).toEqual(f);
  });
  it('omits empty dimensions and tolerates foreign rules', () => {
    expect(filtersToGroup(emptyFilters()).rules).toEqual([]);
    const g = { op: 'and' as const, rules: [{ field: 'due_date', op: 'before', value: '2026-01-01' }, { field: 'status', op: 'in', value: ['done', 3] }, null, { field: 'bogus', op: 'in', value: ['x'] }] };
    expect(groupToFilters(g)).toEqual({ ...emptyFilters(), status: ['done'] });
    expect(groupToFilters(null)).toEqual(emptyFilters());
  });
  it('priority filter applies and parses from the URL', () => {
    const issues = seedIssues(50);
    const f = parseFilters(new URLSearchParams('priority=1,2,9'));
    expect(f.priority).toEqual(['1', '2']);
    const out = applyFilters(issues, f);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((i) => i.priority === 1 || i.priority === 2)).toBe(true);
  });
  it('builds the shareable URL', () => {
    expect(viewUrl('https://x.test', '/', 'abc')).toBe('https://x.test/?v=abc');
  });
});

describe('http views client', () => {
  const row: SavedView = { id: 'v1', team_id: null, name: 'Mine', shared: false, layout: 'list', filters: { op: 'and', rules: [] }, version: 3 };
  it('lists, creates with the group body, deletes with If-Match', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST') return new Response(JSON.stringify(row), { status: 201 });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ items: [row] }));
    }) as unknown as typeof fetch;
    const c = httpViewsClient('acme', f);
    expect(await c.list()).toEqual([row]);
    await c.create({ name: 'Mine', shared: true, layout: 'board', filters: { ...emptyFilters(), priority: ['1'] } });
    const body = JSON.parse(String(calls[1]!.init!.body));
    expect(body).toMatchObject({ name: 'Mine', shared: true, layout: 'board', filters: { op: 'and', rules: [{ field: 'priority', op: 'in', value: ['1'] }] } });
    expect(await c.remove(row)).toBe(true);
    expect((calls[2]!.init!.headers as Record<string, string>)['if-match']).toBe('"3"');
    expect(calls[2]!.url).toBe('/api/v1/w/acme/views/v1');
  });
  it('degrades quietly on failure', async () => {
    const f = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    const c = httpViewsClient('acme', f);
    expect(await c.list()).toEqual([]);
    expect(await c.create({ name: 'x', shared: false, layout: 'list', filters: emptyFilters() })).toBeNull();
    expect(await c.remove(row)).toBe(false);
  });
  it('mock client keeps rows in memory', async () => {
    const c = mockViewsClient();
    const v = await c.create({ name: 'A', shared: false, layout: 'list', filters: emptyFilters() });
    expect((await c.list()).map((x) => x.name)).toEqual(['A']);
    await c.remove(v!);
    expect(await c.list()).toEqual([]);
  });
});

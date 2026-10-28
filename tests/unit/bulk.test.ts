import { describe, it, expect } from 'vitest';
import { applyBulkLocal, inverseGroups, labelTogglePatch, chunk } from '../../src/lib/bulk';
import { bulkPatch } from '../../src/lib/api-client';
import type { Issue } from '../../src/lib/issues';

const mk = (id: string, o: Partial<Issue> = {}): Issue => ({ id, title: id, description: '', status: 'todo', priority: 0, assignee_id: null, project_id: null, cycle_id: null, label_ids: [], parent_id: null, sort_key: id, version: 1, created_at: '', deleted_at: null, ...o });

describe('bulk helpers', () => {
  it('applies a patch locally, labels as add/remove', () => {
    const r = applyBulkLocal(mk('a', { label_ids: ['x'] }), { status: 'done', label_ids_add: ['y'], label_ids_remove: ['x'] });
    expect(r.status).toBe('done'); expect(r.label_ids).toEqual(['y']);
  });
  it('inverse groups issues by the patch that restores them and skips no-ops', () => {
    const g = inverseGroups([mk('a', { status: 'todo' }), mk('b', { status: 'todo' }), mk('c', { status: 'done' })], { status: 'done' });
    expect(g).toEqual([{ ids: ['a', 'b'], patch: { status: 'todo' } }]);
    const l = inverseGroups([mk('a', { label_ids: ['x'] }), mk('b')], { label_ids_add: ['x'] });
    expect(l).toEqual([{ ids: ['b'], patch: { label_ids_remove: ['x'] } }]);
    expect(inverseGroups([mk('a', { project_id: 'p' }), mk('b', { project_id: null })], { project_id: null })).toEqual([{ ids: ['a'], patch: { project_id: 'p' } }]);
  });
  it('toggles a label on a selection', () => {
    expect(labelTogglePatch([mk('a', { label_ids: ['x'] }), mk('b', { label_ids: ['x'] })], 'x')).toEqual({ label_ids_remove: ['x'] });
    expect(labelTogglePatch([mk('a', { label_ids: ['x'] }), mk('b')], 'x')).toEqual({ label_ids_add: ['x'] });
  });
  it('chunks', () => { expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]); });
  it('bulkPatch posts ids+patch and fails every id on HTTP error', async () => {
    let body = '';
    const ok = (async (_u: string, init?: RequestInit) => { body = String(init?.body); return new Response(JSON.stringify({ succeeded: ['a'], failed: [{ id: 'b', code: 'not_found', message: 'nf' }] })); }) as unknown as typeof fetch;
    expect(await bulkPatch('w', ['a', 'b'], { priority: 1 }, ok)).toEqual({ succeeded: ['a'], failed: [{ id: 'b', code: 'not_found', message: 'nf' }] });
    expect(JSON.parse(body)).toEqual({ ids: ['a', 'b'], patch: { priority: 1 } });
    const bad = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    expect((await bulkPatch('w', ['a', 'b'], {}, bad)).failed).toHaveLength(2);
  });
});

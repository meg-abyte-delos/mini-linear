import { describe, expect, it, vi } from 'vitest';
import { rebase } from '@/lib/sync/merge';
import { SyncStore } from '@/lib/sync/store';

const row = (v: number, x: Record<string, unknown> = {}) => ({ id: 'i1', version: v, title: 'A', status: 'todo', priority: 0, label_ids: ['l1'], ...x });

describe('rebase (field-level LWW)', () => {
  it('keeps local edited fields, takes remote for the rest', () => {
    const r = rebase(row(1), row(2, { priority: 3 }), { title: 'mine' });
    expect(r.merged).toMatchObject({ title: 'mine', priority: 3, version: 2 });
    expect(r.conflicts).toEqual([]);
  });
  it('reports a conflict when both sides changed the same field differently; local wins', () => {
    const r = rebase(row(1), row(2, { title: 'theirs' }), { title: 'mine' });
    expect(r.merged.title).toBe('mine');
    expect(r.conflicts).toEqual(['title']);
  });
  it('same value on both sides is not a conflict; arrays compared by value', () => {
    expect(rebase(row(1), row(2, { title: 'x' }), { title: 'x' }).conflicts).toEqual([]);
    expect(rebase(row(1), row(2, { label_ids: ['l2'] }), { label_ids: ['l2'] }).conflicts).toEqual([]);
    expect(rebase(row(1), row(2, { label_ids: ['l2'] }), { label_ids: ['l3'] }).conflicts).toEqual(['label_ids']);
  });
  it('never overrides id/version', () => {
    expect(rebase(row(1), row(5), { version: 1, id: 'x' } as never).merged).toMatchObject({ id: 'i1', version: 5 });
  });
});

describe('SyncStore', () => {
  it('optimistic layer over server copy, cleared back to server', () => {
    const s = new SyncStore();
    s.applyRemote({ op: 'upsert', type: 'issue', row: row(1) });
    s.applyLocal('issue', 'i1', { status: 'done' });
    expect(s.get('issue', 'i1')?.status).toBe('done');
    expect(s.confirmed('issue', 'i1')?.status).toBe('todo');
    s.clearLocal('issue', 'i1', ['status']);
    expect(s.get('issue', 'i1')?.status).toBe('todo');
  });
  it('ignores out-of-order (older) versions and late upserts after delete', () => {
    const s = new SyncStore();
    s.applyRemote({ op: 'upsert', type: 'issue', row: row(3, { title: 'new' }) });
    s.applyRemote({ op: 'upsert', type: 'issue', row: row(2, { title: 'old' }) });
    expect(s.get('issue', 'i1')?.title).toBe('new');
    s.applyRemote({ op: 'delete', type: 'issue', id: 'i1', version: 4 });
    s.applyRemote({ op: 'upsert', type: 'issue', row: row(3) });
    expect(s.get('issue', 'i1')).toBeNull();
    s.applyRemote({ op: 'upsert', type: 'issue', row: row(5) }); // restore
    expect(s.get('issue', 'i1')?.version).toBe(5);
  });
  it('remote change under a pending edit: merges and records the conflict', () => {
    const s = new SyncStore();
    s.applyRemote({ op: 'upsert', type: 'issue', row: row(1) });
    s.applyLocal('issue', 'i1', { title: 'mine' });
    s.applyRemote({ op: 'upsert', type: 'issue', row: row(2, { title: 'theirs', priority: 2 }) });
    expect(s.get('issue', 'i1')).toMatchObject({ title: 'mine', priority: 2, version: 2 });
    expect(s.conflicts('issue', 'i1')).toEqual(['title']);
    s.clearLocal('issue', 'i1', ['title']);
    expect(s.conflicts('issue', 'i1')).toEqual([]);
  });
  it('all() snapshot is referentially stable until a change; subscribers notified', () => {
    const s = new SyncStore(); const l = vi.fn();
    const un = s.subscribe(l);
    s.applyRemote({ op: 'upsert', type: 'issue', row: row(1) });
    const a = s.all('issue');
    expect(s.all('issue')).toBe(a);
    s.applyLocal('issue', 'i1', { title: 'z' });
    expect(s.all('issue')).not.toBe(a);
    expect(l).toHaveBeenCalledTimes(2);
    un(); s.applyLocal('issue', 'i1', { title: 'q' });
    expect(l).toHaveBeenCalledTimes(2);
  });
  it('local-only entity disappears when its pending fields are cleared', () => {
    const s = new SyncStore();
    s.applyLocal('issue', 'tmp', { id: 'tmp', version: 0, title: 'draft' });
    expect(s.all('issue')).toHaveLength(1);
    s.clearLocal('issue', 'tmp', ['id', 'version', 'title']);
    expect(s.all('issue')).toHaveLength(0);
  });
  it('dump/hydrate round-trips server copies only', () => {
    const s = new SyncStore();
    s.applyRemote({ op: 'upsert', type: 'issue', row: row(1) });
    s.applyLocal('issue', 'i1', { title: 'pending' });
    const t = new SyncStore(); t.hydrate(JSON.parse(JSON.stringify(s.dump())));
    expect(t.get('issue', 'i1')?.title).toBe('A');
  });
});

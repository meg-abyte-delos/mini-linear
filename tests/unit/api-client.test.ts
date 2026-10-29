import { describe, expect, it, vi } from 'vitest';
import { createIssue, isUuid, patchIssue } from '@/lib/api-client';
import { MOCK_ISSUES } from '@/lib/issues';

const prev = { ...MOCK_ISSUES[0]!, id: '0192f3a0-0000-7000-8000-000000000001', version: 3 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('api-client', () => {
  it('sends If-Match with the version and returns the server row', async () => {
    const f = vi.fn(async () => json(200, { ...prev, status: 'done', version: 4, identifier: 'DEL-1' }));
    const r = await patchIssue('ws', prev, 3, { status: 'done' }, f as never);
    expect(r.kind).toBe('ok');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/v1/w/ws/issues/${prev.id}`);
    expect((init.headers as Record<string, string>)['if-match']).toBe('"3"');
    expect(r.kind === 'ok' && r.issue.version).toBe(4);
  });
  it('412 refetches once, reports conflict, never retries the PATCH', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(412, { error: { code: 'precondition_failed' } }))
      .mockResolvedValueOnce(json(200, { ...prev, version: 9 }));
    const r = await patchIssue('ws', prev, 3, { status: 'done' }, f as never);
    expect(r.kind).toBe('conflict');
    expect(r.issue?.version).toBe(9);
    expect(f).toHaveBeenCalledTimes(2);
    expect((f.mock.calls[1]![1] as RequestInit | undefined)?.method).toBeUndefined();
  });
  it('other failures are errors, network throw is an error', async () => {
    expect((await patchIssue('ws', prev, 3, {}, (async () => json(422, {})) as never)).kind).toBe('error');
    expect((await patchIssue('ws', prev, 3, {}, (async () => { throw new Error('x'); }) as never)).kind).toBe('error');
  });
  it('create posts team_id + title', async () => {
    const f = vi.fn(async () => json(201, { ...prev, identifier: 'DEL-2' }));
    expect((await createIssue('ws', 'team-1', 'T', f as never))?.identifier).toBe('DEL-2');
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ team_id: 'team-1', title: 'T' });
  });
  it('isUuid', () => { expect(isUuid(prev.id)).toBe(true); expect(isUuid('u1')).toBe(false); });
  describe('PATCH queue per issue', () => {
    const other = { ...prev, id: '0192f3a0-0000-7000-8000-000000000002' };
    it('two concurrent patches go out in order with If-Match v then v+1', async () => {
      const ifMatch: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const f = vi.fn(async (_u: string, init?: RequestInit) => {
        const v = Number(((init!.headers as Record<string, string>)['if-match']!).replace(/"/g, ''));
        ifMatch.push(String(v));
        if (ifMatch.length === 1) await gate;
        return json(200, { ...other, id: prev.id, version: v + 1 });
      });
      const a = patchIssue('ws', prev, 3, { estimate: 2 }, f as never);
      const b = patchIssue('ws', prev, 3, { due_date: '2020-01-01' }, f as never); // same stale version as the caller read it
      await Promise.resolve();
      expect(f).toHaveBeenCalledTimes(1); // second waits for the first
      release();
      const [ra, rb] = await Promise.all([a, b]);
      expect(ifMatch).toEqual(['3', '4']);
      expect([ra.kind, rb.kind]).toEqual(['ok', 'ok']);
    });
    it('a first PATCH returning 500 does not block the second', async () => {
      const id = '0192f3a0-0000-7000-8000-000000000003';
      const p = { ...prev, id };
      const f = vi.fn()
        .mockResolvedValueOnce(json(500, {}))
        .mockResolvedValueOnce(json(200, { ...p, version: 3 })) // refetch after the 500
        .mockResolvedValueOnce(json(200, { ...p, version: 4 }));
      const a = patchIssue('ws', p, 3, { estimate: 1 }, f as never);
      const b = patchIssue('ws', p, 3, { estimate: 2 }, f as never);
      expect((await a).kind).toBe('error');
      expect((await b).kind).toBe('ok');
    });
    it('a first PATCH that throws does not block the second', async () => {
      const id = '0192f3a0-0000-7000-8000-000000000004';
      const p = { ...prev, id };
      const f = vi.fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce(json(200, { ...p, version: 4 }));
      const a = patchIssue('ws', p, 3, { estimate: 1 }, f as never);
      const b = patchIssue('ws', p, 3, { estimate: 2 }, f as never);
      expect((await a).kind).toBe('error');
      expect((await b).kind).toBe('ok');
    });
    it('after a 412 the queued PATCH keeps its own If-Match (no silent overwrite of a foreign edit)', async () => {
      const id = '0192f3a0-0000-7000-8000-000000000005';
      const p = { ...prev, id };
      const seen: string[] = [];
      const f = vi.fn(async (_u: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          seen.push((init.headers as Record<string, string>)['if-match']!);
          return json(412, {});
        }
        return json(200, { ...p, version: 9 }); // refetch: someone else is at v9
      });
      const a = patchIssue('ws', p, 3, { estimate: 1 }, f as never);
      const b = patchIssue('ws', p, 3, { estimate: 2 }, f as never);
      expect((await a).kind).toBe('conflict');
      expect((await b).kind).toBe('conflict');
      expect(seen).toEqual(['"3"', '"3"']);
    });
    it('every PATCH carries an abort signal (timeout)', async () => {
      const id = '0192f3a0-0000-7000-8000-000000000006';
      const f = vi.fn(async () => json(200, { ...prev, id, version: 4 }));
      await patchIssue('ws', { ...prev, id }, 3, {}, f as never);
      expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1]).signal).toBeInstanceOf(AbortSignal);
    });
  });
});

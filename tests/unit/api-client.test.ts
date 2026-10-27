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
});

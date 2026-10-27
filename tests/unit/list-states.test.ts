import { describe, it, expect } from 'vitest';
import { listIssues, parseSimState } from '@/lib/mock-api';

describe('listIssues simulation states', () => {
  it('parses only known states', () => {
    expect(parseSimState('error')).toBe('error');
    expect(parseSimState(['empty', 'x'])).toBe('empty');
    expect(parseSimState('bogus')).toBeUndefined();
    expect(parseSimState(undefined)).toBeUndefined();
  });
  it('error rejects, empty returns [], loading resolves after the delay, default returns issues', async () => {
    await expect(listIssues('error')).rejects.toThrow('Could not load issues');
    expect(await listIssues('empty')).toEqual([]);
    const t = Date.now();
    expect((await listIssues('loading', 60)).length).toBeGreaterThan(0);
    expect(Date.now() - t).toBeGreaterThanOrEqual(50);
    expect((await listIssues()).length).toBeGreaterThan(0);
  });
});

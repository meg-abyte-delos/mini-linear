import { describe, it, expect } from 'vitest';
import { buildCsp } from '../../src/lib/csp';
import { fuzzyFilter } from '../../src/lib/fuzzy';

describe('S10 CSP', () => {
  const csp = buildCsp('abc');
  it('uses nonce, no unsafe-inline/eval', () => {
    expect(csp).toContain(`script-src 'self' 'nonce-abc'`);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
  });
  it('has required directives', () => {
    for (const d of [`default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`]) expect(csp).toContain(d);
  });
});

describe('fuzzy', () => {
  it('matches subsequences, ranks tight matches first', () => {
    expect(fuzzyFilter(['Go to board view', 'Create issue'], 'cri', (x) => x)[0]).toBe('Create issue');
    expect(fuzzyFilter(['a'], 'zz', (x) => x)).toEqual([]);
  });
});

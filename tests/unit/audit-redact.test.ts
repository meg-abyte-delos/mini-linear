import { describe, expect, it } from 'vitest';
import { redact } from '@/lib/audit';

describe('redact (#29)', () => {
  it('matches camelCase and snake_case secret keys', () => {
    const out = JSON.stringify(redact({ passwordHash: 'h', accessToken: 't', apiSecret: 's', Cookie: 'c', title: 'ok', n: { refreshToken: 'x' } }));
    for (const leak of ['"h"', '"t"', '"s"', '"c"', '"x"']) expect(out).not.toContain(leak);
    expect(out).toContain('"ok"');
  });
});

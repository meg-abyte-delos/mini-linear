import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../../src/proxy';
import { SECURITY_HEADERS } from '../../src/lib/csp';

// A session cookie is present: anonymous page requests are redirected to /login before CSP (covered in auth-guard.test).
const run = () => proxy(new NextRequest('http://localhost/', { headers: { cookie: 'ml_session=t' } }));
const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1];

describe('login guard vs ML_DEV_AUTH', () => {
  afterEach(() => vi.unstubAllEnvs());
  const anon = () => proxy(new NextRequest('http://localhost/'));
  it('anonymous page requests go to /login', () => {
    vi.stubEnv('ML_DEV_AUTH', '');
    expect(anon().headers.get('location')).toMatch(/\/login$/);
  });
  it('ML_DEV_AUTH=1 switches the guard off outside production', () => {
    vi.stubEnv('ML_DEV_AUTH', '1'); vi.stubEnv('NODE_ENV', 'development');
    expect(anon().headers.get('location')).toBeNull();
  });
  it('ML_DEV_AUTH=1 cannot disable the guard in a production build', () => {
    vi.stubEnv('ML_DEV_AUTH', '1'); vi.stubEnv('NODE_ENV', 'production');
    expect(anon().headers.get('location')).toMatch(/\/login$/);
  });
});

describe('proxy (S10)', () => {
  it('issues a different nonce per request', () => {
    const a = nonceOf(run().headers.get('content-security-policy')!);
    const b = nonceOf(run().headers.get('content-security-policy')!);
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
  it('response nonce equals the nonce forwarded to the render (x-nonce)', () => {
    const res = run();
    const fromCsp = nonceOf(res.headers.get('content-security-policy')!);
    // NextResponse.next({request:{headers}}) exposes forwarded request headers this way
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(fromCsp);
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(res.headers.get('content-security-policy'));
  });
  it('sets every security header', () => {
    const res = run();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });
});

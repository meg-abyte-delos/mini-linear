import { describe, it, expect } from 'vitest';
import { loginRedirect, safeNext } from '@/lib/auth/guard';

describe('loginRedirect', () => {
  it('does nothing outside API mode', () => expect(loginRedirect('/', '', false, false)).toBeNull());
  it('does nothing with a session', () => expect(loginRedirect('/', '', true, true)).toBeNull());
  it('sends anonymous page requests to /login', () => expect(loginRedirect('/', '', false, true)).toBe('/login'));
  it('keeps the target in next', () => expect(loginRedirect('/w/acme/issue/DEL-1', '?x=1', false, true)).toBe('/login?next=%2Fw%2Facme%2Fissue%2FDEL-1%3Fx%3D1'));
  it('leaves /login, /signup and /api alone', () => {
    for (const p of ['/login', '/signup', '/api/v1/auth/login']) expect(loginRedirect(p, '', false, true)).toBeNull();
  });
});
describe('safeNext', () => {
  it('accepts relative paths only', () => {
    expect(safeNext('/w/a')).toBe('/w/a');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '', null, undefined, '/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/ /evil.com']) expect(safeNext(bad as string)).toBe('/');
  });
  it('allows a percent-encoded tab (same origin, no decoding)', () => expect(safeNext('/%09/evil.com')).toBe('/%09/evil.com'));
  it('keeps query and hash', () => expect(safeNext('/w/a?x=1#h')).toBe('/w/a?x=1#h'));
});

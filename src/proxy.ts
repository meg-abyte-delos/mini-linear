import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, SECURITY_HEADERS } from '@/lib/csp';

export function proxy(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico).*)' }] };

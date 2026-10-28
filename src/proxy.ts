import { NextResponse, type NextRequest } from 'next/server';
import { originAllowed } from '@/lib/auth/origin';
import { buildCsp, SECURITY_HEADERS } from '@/lib/csp';

export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/') && !originAllowed(req)) {
    return NextResponse.json({ error: { code: 'forbidden', message: 'cross-origin request refused', request_id: crypto.randomUUID() } }, { status: 403 });
  }
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

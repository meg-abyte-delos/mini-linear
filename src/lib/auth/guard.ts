// Page guard: decides whether a request must be sent to /login. Cookie presence only (cheap, edge-safe);
// the session itself is validated server-side by the API handlers.
export const PUBLIC_PATHS = ['/login', '/signup'];
export function loginRedirect(pathname: string, search: string, hasSession: boolean, apiMode: boolean): string | null {
  if (!apiMode || hasSession) return null;
  if (pathname.startsWith('/api/') || PUBLIC_PATHS.includes(pathname)) return null;
  const next = pathname === '/' && !search ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return `/login${next}`;
}
// Only same-origin relative paths are honoured after login (no open redirect). Control chars (tab, newline...) are refused
// because URL parsers strip them ("/\t/evil.com" -> "//evil.com"); the origin re-check is the backstop.
export function safeNext(n: string | null | undefined, origin: string = typeof location !== 'undefined' ? location.origin : 'http://localhost'): string {
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (!n || !/^\/(?![/\\])[^\x00-\x20]*$/.test(n)) return '/';
  try { return new URL(n, origin).origin === new URL(origin).origin ? n : '/'; } catch { return '/'; }
}

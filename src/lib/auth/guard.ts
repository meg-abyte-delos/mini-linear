// Page guard: decides whether a request must be sent to /login. Cookie presence only (cheap, edge-safe);
// the session itself is validated server-side by the API handlers.
export const PUBLIC_PATHS = ['/login', '/signup'];
export function loginRedirect(pathname: string, search: string, hasSession: boolean, apiMode: boolean): string | null {
  if (!apiMode || hasSession) return null;
  if (pathname.startsWith('/api/') || PUBLIC_PATHS.includes(pathname)) return null;
  const next = pathname === '/' && !search ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return `/login${next}`;
}
// Only same-origin relative paths are honoured after login (no open redirect).
export const safeNext = (n: string | null | undefined): string => (n && /^\/(?![/\\])/.test(n) ? n : '/');

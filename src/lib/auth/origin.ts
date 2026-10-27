const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence for cookie auth: a state-changing request carrying an Origin must match the request host.
 * Sec-Fetch-Site cross-site is refused too. Requests with neither header (curl, server-to-server) have no ambient
 * browser cookies to abuse and pass; SameSite=Lax on the cookie covers the rest.
 */
export function originAllowed(req: Request): boolean {
  if (!UNSAFE.has(req.method)) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const origin = req.headers.get("origin");
  if (origin !== null) {
    try { return new URL(origin).host === host; } catch { return false; }
  }
  const site = req.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

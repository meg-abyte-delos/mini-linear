// Runs once at server start: a misconfigured dev-auth flag or a missing socket resolver in prod crashes the boot instead of serving.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  const { installDevAuth } = await import('@/lib/dev-auth');
  installDevAuth();
  const { warnIfNoSocketResolver } = await import('./lib/auth/ratelimit');
  warnIfNoSocketResolver();
}

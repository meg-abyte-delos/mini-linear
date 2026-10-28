// Runs once at server start: a misconfigured dev-auth flag or a missing socket resolver in prod crashes the boot instead of serving.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  const { installDevAuth } = await import('@/lib/dev-auth');
  installDevAuth();
  const { warnIfNoSocketResolver } = await import('./lib/auth/ratelimit');
  warnIfNoSocketResolver();
  if (process.env.DATABASE_URL) {
    const { startPurgeScheduler } = await import('./lib/auth/ratelimit');
    const { db } = await import('./lib/http/ctx');
    startPurgeScheduler(db());
    if (process.env.WEBHOOKS_DISABLED !== '1') {
      const { startWebhookDispatcher } = await import('./lib/integrations/webhooks');
      startWebhookDispatcher(db());
    }
  }
}

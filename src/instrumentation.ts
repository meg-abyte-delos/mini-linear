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
    const { startAttachmentGc } = await import('./lib/attachments/uploads');
    startAttachmentGc(db());
    if (process.env.WEBHOOKS_DISABLED !== '1') {
      const { startWebhookDispatcher } = await import('./lib/integrations/webhooks');
      // Own LOGIN role (member of webhook_dispatcher) when configured; otherwise the app pool + SET LOCAL ROLE (dev/CI).
      const url = process.env.WEBHOOK_DISPATCHER_DATABASE_URL;
      const postgres = (await import('postgres')).default;
      startWebhookDispatcher(url ? postgres(url, { max: 2 }) : db(), { asRole: !url });
    }
  }
}

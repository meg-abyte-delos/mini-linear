import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const installDevAuth = vi.fn();
const warnIfNoSocketResolver = vi.fn();
const startPurgeScheduler = vi.fn();
const startWebhookDispatcher = vi.fn();
const fakeDb = {};

vi.mock('@/lib/dev-auth', () => ({ installDevAuth }));
vi.mock('../../src/lib/auth/ratelimit', () => ({ warnIfNoSocketResolver, startPurgeScheduler }));
vi.mock('../../src/lib/integrations/webhooks', () => ({ startWebhookDispatcher }));
vi.mock('../../src/lib/http/ctx', () => ({ db: () => fakeDb }));

const env = { ...process.env };

describe('instrumentation register()', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });
  afterEach(() => { process.env = { ...env }; });

  it('keeps dev-auth + resolver checks and starts the purge scheduler when DATABASE_URL is set', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.DATABASE_URL = 'postgres://x';
    await (await import('../../src/instrumentation')).register();
    expect(installDevAuth).toHaveBeenCalledOnce();
    expect(warnIfNoSocketResolver).toHaveBeenCalledOnce();
    expect(startPurgeScheduler).toHaveBeenCalledWith(fakeDb);
    expect(startWebhookDispatcher).toHaveBeenCalledWith(fakeDb, { asRole: true });
  });

  it('does not start the scheduler without DATABASE_URL', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.DATABASE_URL;
    await (await import('../../src/instrumentation')).register();
    expect(installDevAuth).toHaveBeenCalledOnce();
    expect(startPurgeScheduler).not.toHaveBeenCalled();
  });

  it('does nothing on the edge runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    process.env.DATABASE_URL = 'postgres://x';
    await (await import('../../src/instrumentation')).register();
    expect(installDevAuth).not.toHaveBeenCalled();
    expect(startPurgeScheduler).not.toHaveBeenCalled();
  });
});

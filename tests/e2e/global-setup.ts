// One real login per seeded persona; specs reuse the session through storageState (no auto-login anywhere).
import { request, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { USERS } from '../../scripts/demo-ids';

export const STORAGE_STATE = 'tests/e2e/.auth/demo.json';
export const GUEST_STATE = 'tests/e2e/.auth/guest.json';
export const INBOX_STATE = 'tests/e2e/.auth/inbox.json';
export const DEMO_EMAIL = USERS.admin.email;

export default async function globalSetup(config: FullConfig) {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) throw new Error('SEED_DEMO_PASSWORD is required for e2e (same value the demo seed used)');
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3000';
  mkdirSync('tests/e2e/.auth', { recursive: true });
  for (const [email, path] of [[USERS.admin.email, STORAGE_STATE], [USERS.guest.email, GUEST_STATE], [USERS.inbox.email, INBOX_STATE]] as const) {
    const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
    const res = await ctx.post('/api/v1/auth/login', { data: { email, password } });
    if (!res.ok()) throw new Error(`login ${email} failed: ${res.status()} (was \`pnpm db:seed-demo\` run with the same SEED_DEMO_PASSWORD?)`);
    await ctx.storageState({ path });
    await ctx.dispose();
  }
}

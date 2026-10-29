// One real login as the seeded demo user; every spec reuses the session through storageState (no auto-login anywhere).
import { request, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';

export const STORAGE_STATE = 'tests/e2e/.auth/demo.json';
export const DEMO_EMAIL = 'demo@example.test';

export default async function globalSetup(config: FullConfig) {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) throw new Error('SEED_DEMO_PASSWORD is required for e2e (same value the demo seed used)');
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3000';
  const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
  const res = await ctx.post('/api/v1/auth/login', { data: { email: DEMO_EMAIL, password } });
  if (!res.ok()) throw new Error(`demo login failed: ${res.status()} (was \`pnpm db:seed-demo\` run with the same SEED_DEMO_PASSWORD?)`);
  mkdirSync('tests/e2e/.auth', { recursive: true });
  await ctx.storageState({ path: STORAGE_STATE });
  await ctx.dispose();
}

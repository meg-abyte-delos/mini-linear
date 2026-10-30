import { defineConfig } from '@playwright/test';
import { applyIsolatedE2eEnv } from './scripts/e2e-db-env';

// E2E_ISOLATED=1: run against the throwaway e2e DB (see scripts/e2e-db.mts), never the demo DB.
applyIsolatedE2eEnv();
export default defineConfig({
  testDir: 'tests/e2e',
  // One worker: all specs share one persistent Postgres and the live change feed (SSE) pushes every mutation to every open tab,
  // so parallel files interfere with each other (rows move, counts change mid-test).
  workers: 1,
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:3000', storageState: 'tests/e2e/.auth/demo.json' },
  webServer: {
    // CI already ran `pnpm build` in the same job: reuse that artifact instead of rebuilding.
    command: process.env.CI ? 'pnpm start' : 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    // Isolated runs must never attach to a server already bound to the demo DB.
    reuseExistingServer: !process.env.CI && process.env.E2E_ISOLATED !== '1',
    timeout: 180000,
    // PERF_SEED enables the ?seed=N perf fixture; ML_ALLOW_SHARED_RATELIMIT_BUCKET lets next start run without a socket resolver (see ratelimit.ts).
    env: { PERF_SEED: '1', ML_ALLOW_SHARED_RATELIMIT_BUCKET: '1' },
  },
});

import { defineConfig } from '@playwright/test';
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
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
    // PERF_SEED enables the ?seed=N perf fixture; ML_ALLOW_SHARED_RATELIMIT_BUCKET lets next start run without a socket resolver (see ratelimit.ts).
    env: { PERF_SEED: '1', ML_ALLOW_SHARED_RATELIMIT_BUCKET: '1' },
  },
});

// CI gate (Tess, per Rex): integration suites FAIL, never skip, when enabled and env is missing.
// TEST_BASE_URL is not required: world.ts defaults it to http://localhost:3000.
const REQUIRED = ['APP_DATABASE_URL', 'OWNER_DATABASE_URL'];
const missing = REQUIRED.filter((k) => !process.env[k]);
const ci = process.env.CI === 'true';
const enabled = process.env.INTEGRATION === '1' || ci;
if (ci && missing.length) { throw new Error(`Integration env missing in CI: ${missing.join(', ')}`); }
if (enabled && missing.length) { throw new Error(`Integration env missing: ${missing.join(', ')}`); }
export const runIntegration = enabled;

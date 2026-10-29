import { it, expect } from 'vitest';
import { runIntegration } from './helpers/gate';

// CI boots the app and sets TEST_BASE_URL + DATABASE_OWNER_URL: integration suites must not be silently skipped there.
it('in CI, integration suites are not skipped', () => {
  if (process.env.CI) expect(runIntegration).toBe(true);
});

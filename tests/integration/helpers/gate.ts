// Black-box HTTP suites (T2-T7, S10-S12 live checks) run only against a running app: set TEST_BASE_URL plus the DB urls.
// TODO(M1): enable in CI once M1 sessions land and CI boots the app (`next start`) before vitest.
export const runIntegration = !!(process.env.TEST_BASE_URL && process.env.DATABASE_OWNER_URL);

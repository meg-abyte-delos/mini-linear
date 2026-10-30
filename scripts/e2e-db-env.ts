// Isolated e2e database: the demo DB (what people look at) must never receive e2e writes.
// `E2E_ISOLATED=1` (set by `pnpm test:e2e:isolated`) rewrites the database name in the three URLs; CI is untouched
// because its Postgres service is already throwaway.
export const E2E_DB_NAME = process.env.E2E_DB_NAME ?? 'mini_linear_e2e';

export function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export function useIsolatedE2eDb(): boolean {
  return process.env.E2E_ISOLATED === '1';
}

/** Point DATABASE_URL / DATABASE_OWNER_URL / PGSUPER_URL at the e2e DB (idempotent). */
export function applyIsolatedE2eEnv(): void {
  if (!useIsolatedE2eDb()) return;
  for (const k of ['DATABASE_URL', 'DATABASE_OWNER_URL', 'PGSUPER_URL'] as const) {
    const v = process.env[k];
    if (v) process.env[k] = withDb(v, E2E_DB_NAME);
  }
}

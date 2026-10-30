// Provision (drop + recreate) the throwaway e2e database, apply roles, migrations, grants and the demo seed.
// Usage: E2E_ISOLATED=1 tsx scripts/e2e-db.mts   (needs PGSUPER_URL, DATABASE_OWNER_URL, DATABASE_URL, SEED_DEMO_PASSWORD, E2E_PASSWORD)
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { E2E_DB_NAME, withDb } from './e2e-db-env';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const superUrl = need('PGSUPER_URL');
const ownerUrl = need('DATABASE_OWNER_URL');
const appUrl = need('DATABASE_URL');
need('SEED_DEMO_PASSWORD');
need('E2E_PASSWORD');

if (process.env.NODE_ENV === 'production') throw new Error('e2e-db refuses to run in production');
// Guard: never wipe the database people use for the demo. E2E_DB_NAME goes raw into DROP/CREATE DATABASE, so it is
// anchored to a plain identifier that contains e2e or test (no quotes, spaces or semicolons can get through).
const demoDb = new URL(ownerUrl).pathname.slice(1);
if (!/^[a-z0-9_]*(e2e|test)[a-z0-9_]*$/.test(E2E_DB_NAME) || E2E_DB_NAME === demoDb) throw new Error(`refusing to reset "${E2E_DB_NAME}": name must match ^[a-z0-9_]*(e2e|test)[a-z0-9_]*$ and differ from the demo DB`);
// Local hosts only: DROP DATABASE ... WITH (FORCE) must never reach a remote server (same rule as seed-demo-rich).
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
for (const [k, u] of [['PGSUPER_URL', superUrl], ['DATABASE_OWNER_URL', ownerUrl], ['DATABASE_URL', appUrl]] as const) {
  const host = new URL(u).hostname;
  if (!LOCAL_HOSTS.includes(host)) throw new Error(`e2e-db refuses to run: ${k} host "${host}" is not local`);
}
// Role names are interpolated inside double quotes; passwords are escaped as SQL literals (never spliced raw).
const ident = (n: string) => { if (!/^[A-Za-z0-9_]+$/.test(n)) throw new Error(`unsafe role name "${n}"`); return n; };
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

const ownerName = ident(decodeURIComponent(new URL(ownerUrl).username));
const appName = ident(decodeURIComponent(new URL(appUrl).username));
const appPass = decodeURIComponent(new URL(appUrl).password);

async function run(url: string, sql: string, label: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { await c.query(sql); } catch (e) { throw new Error(`${label}: ${(e as Error).message}`); } finally { await c.end(); }
}

async function main() {
  const admin = withDb(superUrl, 'postgres');
  await run(admin, `DROP DATABASE IF EXISTS "${E2E_DB_NAME}" WITH (FORCE)`, 'drop');
  await run(admin, `DO $e2e$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=${lit(ownerName)}) THEN CREATE ROLE "${ownerName}" LOGIN PASSWORD ${lit(decodeURIComponent(new URL(ownerUrl).password))} NOSUPERUSER NOBYPASSRLS CREATEROLE; END IF; END $e2e$`, 'owner role');
  await run(admin, `CREATE DATABASE "${E2E_DB_NAME}" OWNER "${ownerName}"`, 'create');
  const sup = withDb(superUrl, E2E_DB_NAME);
  const owner = withDb(ownerUrl, E2E_DB_NAME);
  await run(sup, readFileSync('db/bootstrap-roles.sql', 'utf8').replace(':"owner"', `"${ownerName}"`), 'bootstrap-roles');
  await run(owner, readFileSync('db/roles/001_app_user.sql', 'utf8'), 'app_user');
  await run(owner, `ALTER ROLE "${appName}" PASSWORD ${lit(appPass)}`, 'app_user password');
  for (const f of readdirSync('db/migrations').filter((x) => x.endsWith('.sql')).sort()) await run(owner, readFileSync(`db/migrations/${f}`, 'utf8'), f);
  await run(owner, readFileSync('db/roles/900_grants.sql', 'utf8'), 'grants');
  const env = { ...process.env, DATABASE_OWNER_URL: owner, DATABASE_URL: withDb(appUrl, E2E_DB_NAME) };
  for (let i = 0; i < 2; i++) { // twice: proves idempotence like CI
    const r = spawnSync('pnpm', ['db:seed-demo'], { env, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('seed-demo failed');
  }
  console.log(`e2e database "${E2E_DB_NAME}" ready (demo DB "${demoDb}" untouched)`);
}
main().catch((e) => { console.error(e); process.exit(1); });

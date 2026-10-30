// Provision (drop + recreate) the throwaway e2e database, apply roles, migrations, grants and the demo seed.
// Usage: E2E_ISOLATED=1 tsx scripts/e2e-db.mts   (needs PGSUPER_URL, DATABASE_OWNER_URL, DATABASE_URL, SEED_DEMO_PASSWORD)
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

if (process.env.NODE_ENV === 'production') throw new Error('e2e-db refuses to run in production');
// Guard: never wipe the database people use for the demo.
const demoDb = new URL(ownerUrl).pathname.slice(1);
if (!/e2e|test/i.test(E2E_DB_NAME) || E2E_DB_NAME === demoDb) throw new Error(`refusing to reset "${E2E_DB_NAME}": name must contain e2e/test and differ from the demo DB`);

const ownerName = decodeURIComponent(new URL(ownerUrl).username);
const appName = decodeURIComponent(new URL(appUrl).username);
const appPass = decodeURIComponent(new URL(appUrl).password);

async function run(url: string, sql: string, label: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { await c.query(sql); } catch (e) { throw new Error(`${label}: ${(e as Error).message}`); } finally { await c.end(); }
}

async function main() {
  const admin = withDb(superUrl, 'postgres');
  await run(admin, `DROP DATABASE IF EXISTS "${E2E_DB_NAME}" WITH (FORCE)`, 'drop');
  await run(admin, `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${ownerName}') THEN CREATE ROLE "${ownerName}" LOGIN PASSWORD '${decodeURIComponent(new URL(ownerUrl).password)}' NOSUPERUSER NOBYPASSRLS CREATEROLE; END IF; END $$`, 'owner role');
  await run(admin, `CREATE DATABASE "${E2E_DB_NAME}" OWNER "${ownerName}"`, 'create');
  const sup = withDb(superUrl, E2E_DB_NAME);
  const owner = withDb(ownerUrl, E2E_DB_NAME);
  await run(sup, readFileSync('db/bootstrap-roles.sql', 'utf8').replace(':"owner"', `"${ownerName}"`), 'bootstrap-roles');
  await run(owner, readFileSync('db/roles/001_app_user.sql', 'utf8'), 'app_user');
  await run(owner, `ALTER ROLE "${appName}" PASSWORD '${appPass}'`, 'app_user password');
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

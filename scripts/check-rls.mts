// S12 gate (Spec v1.1 Appendix A). Fails closed: any doubt = exit 1.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const ownerUrl = process.env.DATABASE_OWNER_URL;
const appUrl = process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) { console.error("S12: DATABASE_OWNER_URL and DATABASE_URL must be set"); process.exit(1); }

const allow = new Set(readFileSync("db/rls-exempt-allowlist.txt", "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
const norm = (e: string | null | undefined) => (e ?? "").toLowerCase().replace(/\s+/g, "").replace(/::text/g, "");
// Rule 2 (id-keyed tenant table, e.g. workspaces): no workspace_id column, the row id IS the tenant key.
const ID_KEYED = new Set(["workspaces"]);
const OK_ID = /^\(?id=\(?nullif\(current_setting\('app\.workspace_id',true\),''\)\)?::uuid\)?$/;
const OK = /workspace_id=\(?nullif\(current_setting\('app\.workspace_id',true\),''\)\)?::uuid/;
// Per-user RESTRICTIVE policies (Area 7 inbox) AND with tenant_isolation; they may key on app.user_id instead.
const OK_USER = /user_id=\(?nullif\(current_setting\('app\.user_id',true\),''\)\)?::uuid/;
const errors: string[] = [];
const sql = postgres(ownerUrl, { max: 1 });

try {
  const role = await sql`select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = 'app_user'`;
  if (role.length === 0) errors.push("app_user role missing");
  else if (Object.values(role[0]!).some(Boolean)) errors.push("app_user has SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB");

  const memberOf = await sql`select r.rolname from pg_roles r where r.rolname <> 'app_user' and pg_has_role('app_user', r.oid, 'MEMBER') and (r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolname in ('pg_write_all_data','pg_read_all_data','pg_database_owner'))`;
  for (const m of memberOf) errors.push(`app_user is member of privileged role ${m.rolname}`);

  const [cr] = await sql`select has_schema_privilege('app_user','public','CREATE') s, has_database_privilege('app_user', current_database(), 'CREATE') d`;
  if (cr!.s) errors.push("app_user has CREATE on schema public");
  if (cr!.d) errors.push("app_user has CREATE on database");

  const owned = await sql`
    select 'relation '||c.relname o from pg_class c join pg_roles r on r.oid=c.relowner where r.rolname='app_user'
    union all select 'schema '||n.nspname from pg_namespace n join pg_roles r on r.oid=n.nspowner where r.rolname='app_user'
    union all select 'function '||p.proname from pg_proc p join pg_roles r on r.oid=p.proowner where r.rolname='app_user'`;
  for (const o of owned) errors.push(`app_user owns ${o.o}`);

  const tables = await sql`
    select c.oid, c.relname, c.relrowsecurity rls, c.relforcerowsecurity force,
      exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='workspace_id' and not a.attisdropped) has_ws
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relname not like '\_\_drizzle%'`;
  const seen = new Set<string>();
  for (const t of tables) {
    seen.add(t.relname);
    if (allow.has(t.relname)) { if (t.has_ws) errors.push(`${t.relname}: allowlisted but has workspace_id (should be under RLS)`); continue; }
    if (ID_KEYED.has(t.relname)) {
      if (t.has_ws) { errors.push(`${t.relname}: id-keyed table must not have workspace_id`); continue; }
      if (!t.rls || !t.force) errors.push(`${t.relname}: ENABLE + FORCE RLS required (id-keyed)`);
      const ip = await sql`select qual, with_check, cmd from pg_policies where schemaname='public' and tablename=${t.relname}`;
      if (ip.length === 0) errors.push(`${t.relname}: no policy (id-keyed)`);
      for (const p of ip) {
        if (!OK_ID.test(norm(p.qual))) errors.push(`${t.relname}: id-keyed policy USING must be id = nullif(current_setting('app.workspace_id', true), '')::uuid`);
        if (p.cmd !== "SELECT" && p.cmd !== "DELETE" && !OK_ID.test(norm(p.with_check))) errors.push(`${t.relname}: id-keyed policy WITH CHECK missing or wrong`);
      }
      continue;
    }
    if (!t.has_ws) { errors.push(`${t.relname}: no workspace_id and not in allowlist`); continue; }
    if (!t.rls || !t.force) errors.push(`${t.relname}: ENABLE + FORCE RLS required`);
    const pols = await sql`select qual, with_check, cmd, permissive from pg_policies where schemaname='public' and tablename=${t.relname}`;
    if (pols.length === 0) errors.push(`${t.relname}: no policy`);
    for (const p of pols) {
      const q = (p.qual ?? "").replace(/\s+/g, " ");
      const w = (p.with_check ?? "").replace(/\s+/g, " ");
      if (p.permissive === "RESTRICTIVE" && OK_USER.test(norm(q))) { if (p.cmd !== "SELECT" && p.cmd !== "DELETE" && !OK_USER.test(norm(w))) errors.push(`${t.relname}: user policy WITH CHECK missing or wrong`); continue; }
      if (!OK.test(norm(q))) errors.push(`${t.relname}: policy USING must use nullif(current_setting('app.workspace_id', true), '')::uuid`);
      if (p.cmd !== "SELECT" && p.cmd !== "DELETE" && !OK.test(norm(w))) errors.push(`${t.relname}: policy WITH CHECK missing or wrong`);
    }
  }
  for (const a of allow) if (!seen.has(a)) errors.push(`allowlist entry '${a}' has no table (stale)`);

  const views = await sql`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)`;
  for (const v of views) errors.push(`view ${v.relname}: must be security_invoker`);

  const secdef = await sql`select p.proname, p.proconfig, has_function_privilege('public', p.oid, 'EXECUTE') pub from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef`;
  for (const f of secdef) {
    if (!(f.proconfig ?? []).some((c: string) => c.replace(/\s/g, "") === "search_path=pg_catalog,public")) errors.push(`SECDEF ${f.proname}: search_path must be pg_catalog, public`);
    if (f.pub) errors.push(`SECDEF ${f.proname}: EXECUTE granted to PUBLIC`);
  }

  // Behavioral: as app_user without app.workspace_id, every tenant table returns 0 rows.
  const app = postgres(appUrl, { max: 1 });
  try {
    for (const t of tables) {
      if (allow.has(t.relname) || (!t.has_ws && !ID_KEYED.has(t.relname))) continue;
      // id-keyed tables (workspaces): app_user having no SELECT at all is the stronger guarantee.
      if (ID_KEYED.has(t.relname)) { const [g] = await sql`select has_table_privilege('app_user', ${t.oid}::oid, 'SELECT') s`; if (!g!.s) continue; }
      const [r] = await app.unsafe(`select count(*)::int n from public."${t.relname.replace(/"/g, '""')}"`);
      if (r!.n !== 0) errors.push(`${t.relname}: ${r!.n} rows visible to app_user with no workspace set`);
    }
  } finally { await app.end(); }
} catch (e) {
  errors.push(`check crashed: ${(e as Error).message}`);
} finally {
  await sql.end();
}

if (errors.length) { console.error("S12 violations:\n- " + errors.join("\n- ")); process.exit(1); }
console.log("S12 RLS check OK");

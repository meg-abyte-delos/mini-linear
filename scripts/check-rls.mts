// S12 CI check: fail if a table with workspace_id lacks FORCE RLS or a policy, or if app_user owns objects / is superuser.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_OWNER_URL ?? "");
const bad = await sql`
  select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join information_schema.columns col on col.table_name=c.relname and col.column_name='workspace_id' and col.table_schema=n.nspname
  where n.nspname='public' and c.relkind='r'
    and (not c.relforcerowsecurity or not c.relrowsecurity or not exists (select 1 from pg_policies p where p.tablename=c.relname))`;
const owner = await sql`select 1 from pg_roles where rolname='app_user' and (rolsuper or rolbypassrls)
  union all select 1 from pg_class c join pg_roles r on r.oid=c.relowner where r.rolname='app_user'`;
if (bad.length || owner.length) { console.error("S12 violation", { tables: bad.map((r) => r.relname), appUserPrivileged: owner.length > 0 }); process.exit(1); }
console.log("S12 RLS check OK");
await sql.end();

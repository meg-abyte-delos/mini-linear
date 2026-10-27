# Database setup (M1)

Roles:
- **superuser** (CI service / DBA only): runs `db/bootstrap-roles.sql` once (creates `definer`, NOLOGIN BYPASSRLS).
- **owner**: NOSUPERUSER NOBYPASSRLS, member of `definer`. Runs migrations. **Never used at runtime.**
- **app_user**: NOSUPERUSER NOBYPASSRLS, owns nothing. The ONLY role in the runtime `DATABASE_URL`.

Order: bootstrap (superuser) -> `db/roles/001_app_user.sql` (owner) -> `db/migrations/*.sql` via `psql -v ON_ERROR_STOP=1` (owner) -> `db/roles/900_grants.sql` (owner) -> `pnpm check:rls`.

**Migrations are raw SQL applied with psql**, not `drizzle-kit migrate` (its journal is not maintained). `src/db/schema.ts` mirrors the SQL for typed queries only.

Runtime rule (S12, Rex review #7): the owner role is a member of `definer` (BYPASSRLS), so `DATABASE_OWNER_URL` must exist only in migration/CI jobs, never in the app process env. The app reads `DATABASE_URL` (app_user) only.

`resolve_workspace(slug, user)` is SECURITY DEFINER and trusts `p_user`: call it only from the session layer with the user id from a validated session.

`workspaces` is INSERT-only for app_user and FORCE RLS applies to inserts: when creating a workspace, `set_config('app.workspace_id', <new id>, true)` FIRST, then `insert into workspaces ...` WITHOUT `RETURNING` (RETURNING needs SELECT, which app_user lacks). Read workspaces only via `resolve_workspace` / `list_my_workspaces(user)` (both SECURITY DEFINER, trusting the session-derived user id). See `createWorkspace` in `src/lib/resources/tenancy.ts`.
TRUSTED_PROXIES: comma-separated proxy IPs in front of the app (rate-limit client IP = rightmost X-Forwarded-For hop not listed).

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

## Isolated e2e database (local)

E2E specs write data (issues, comments, presence rows). Never point them at the demo DB.
`pnpm test:e2e:isolated` drops and recreates `mini_linear_e2e` (`E2E_DB_NAME` to rename; the name must contain `e2e` or `test`),
applies roles, migrations, grants and the demo seed twice, then runs Playwright with `DATABASE_URL`, `DATABASE_OWNER_URL` and `PGSUPER_URL`
rewritten to that DB. `pnpm db:e2e-reset` only resets it. CI is unchanged: its Postgres service is already throwaway.
Isolated runs never reuse a server already listening on :3000.
Needs `PGSUPER_URL`, `DATABASE_OWNER_URL`, `DATABASE_URL`, `SEED_DEMO_PASSWORD`, `E2E_PASSWORD`.
Playwright server and e2e DB are in API mode, so mock-data specs (e.g. `dnd.spec.ts` list, `search.spec.ts`, `palette-nl.spec.ts` 'me') still belong to the mock-mode `pnpm test:e2e` job.

# Mini-Linear

A small Linear clone built by the Delos Dev Swarm (Meg, Ada, Linus, Tess, Rex). Next.js/TS, Postgres + Drizzle, Vitest, Playwright.

## Rules
- Spec v1.1 + Appendix A are binding: one spec ID per test, merge gate from the first PR.
- Every change: Linear issue, branch from fresh `main`, PR via `gh`, Rex review, CI green. No direct pushes to main.
- Security: the app connects as `app_user` (no BYPASSRLS, owns nothing); FORCE RLS on every tenant table; exempt tables only those in `db/rls-exempt-allowlist.txt`.
- No secrets in the repo. Use `.env.local` (git-ignored); see `.env.example`.

## Modules
- M1 auth/tenancy, M2 data + API, M3 sync: Ada
- M4 UI, M5 search/notifications: Linus
- Tests (from spec only): Tess
- Review, security, global consistency: Rex

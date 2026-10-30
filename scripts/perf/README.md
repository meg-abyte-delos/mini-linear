# Perf bench (issue list)

`node scripts/perf/list-bench.mjs --setup` (needs `PGSUPER_URL`, a superuser URL) builds a scratch DB `ml_perf_bench`
(bootstrap roles, all migrations, grants, `db/seed/perf-seed.sql` with 5000 issues), runs the 11 `listIssues` query
shapes (admin/member/guest visibility, team, status, board column, project, cycle, label, assignee, deep cursor page)
as `app_user` under RLS, and exits 1 when a shape's median EXPLAIN ANALYZE time exceeds `thresholds.json`
or returns no rows. No psql required. Options: `--keep`, `--json=file`, `--runs=N`, `--issues=N`.

Reference (5000 issues, embedded PG 18, main 10d7b49): medians 0.8-3.5 ms, deep page 8.4 ms (seq scan in the bench's
own OFFSET subquery). Limits are ~10x headroom to catch lost indexes / plan regressions, not noise.
Seeding 50k issues takes minutes and was not benched.

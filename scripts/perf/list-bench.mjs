#!/usr/bin/env node
// Perf bench for the issue list (PR #86 / Area 10). No psql needed: pure node + `pg`.
// Runs the query shapes of listIssues (src/lib/issues/handlers.ts) as app_user under RLS against a seeded workspace and
// compares the median EXPLAIN ANALYZE execution time with scripts/perf/thresholds.json. Exit 1 when a shape breaches.
//
//   Fresh scratch DB (bootstrap + migrations + 5000-issue seed), then bench:
//     PGSUPER_URL=postgres://postgres:...@host:5432/postgres node scripts/perf/list-bench.mjs --setup
//   Against an already migrated + seeded DB (CI): DATABASE_URL=<app_user url> WS_ID=<seed workspace id> node scripts/perf/list-bench.mjs
// Options: --runs=N (default 9)  --issues=N (seed size, default 5000)  --keep (do not drop the scratch DB)  --json=path
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, "../..");
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split("=")[1];
const flag = (n) => process.argv.includes(`--${n}`);
const RUNS = Number(arg("runs", 9)), ISSUES = Number(arg("issues", 5000));
const thresholds = JSON.parse(fs.readFileSync(path.join(here, "thresholds.json"), "utf8"));
const withDb = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };

async function one(url, fn) { const c = new pg.Client({ connectionString: url }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }

async function setup() {
  const sup = process.env.PGSUPER_URL; if (!sup) throw new Error("--setup needs PGSUPER_URL (superuser URL on any db)");
  const DB = "ml_perf_bench", OWNER_PW = "ci_only", APP_PW = "ci_only_app";
  // Safety: --setup drops/creates a database and creates roles with throwaway passwords. Local clusters only.
  const su = new URL(sup); const host = su.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === "" || host.startsWith("/") || (su.searchParams.has("host") && su.searchParams.get("host").startsWith("/"));
  if (!local && process.env.PERF_ALLOW_REMOTE !== "1") throw new Error(`--setup refused: PGSUPER_URL host "${host}" is not local (set PERF_ALLOW_REMOTE=1 only for a throwaway cluster)`);
  // Never alter pre-existing roles: their passwords are not ours to reset.
  const pre = await one(sup, (c) => c.query("select rolname from pg_roles where rolname in ('owner','app_user')"));
  if (pre.rows.length) throw new Error(`--setup refused: role(s) already exist on this cluster (${pre.rows.map((r) => r.rolname).join(", ")}); use DATABASE_URL + WS_ID mode instead`);
  const created = { roles: false };
  const drop = async () => one(sup, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${DB}`);
    if (created.roles) for (const r of ["app_user", "owner"]) await c.query(`DROP ROLE IF EXISTS ${r}`).catch(() => {});
  });
  try {
  await one(sup, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${DB}`);
    await c.query(`CREATE ROLE owner LOGIN PASSWORD '${OWNER_PW}' NOSUPERUSER NOBYPASSRLS CREATEROLE`);
    created.roles = true;
    await c.query(`CREATE DATABASE ${DB} OWNER owner`);
  });
  // keeps ?host=<socket dir>
  const as = (user, pw) => { const u = new URL(sup); u.username = user; u.password = pw; u.pathname = `/${DB}`; return u.toString(); };
  const owner = as("owner", OWNER_PW);
  await one(withDb(sup, DB), (c) => c.query(fs.readFileSync(path.join(root, "db/bootstrap-roles.sql"), "utf8").replace(':"owner"', '"owner"')));
  await one(owner, async (c) => {
    await c.query(fs.readFileSync(path.join(root, "db/roles/001_app_user.sql"), "utf8"));
    for (const f of fs.readdirSync(path.join(root, "db/migrations")).filter((x) => x.endsWith(".sql")).sort()) await c.query(fs.readFileSync(path.join(root, "db/migrations", f), "utf8"));
    await c.query(fs.readFileSync(path.join(root, "db/roles/900_grants.sql"), "utf8"));
  });
  await one(withDb(sup, DB), (c) => c.query(`ALTER ROLE app_user PASSWORD '${APP_PW}'`));
  // seed: db/seed/perf-seed.sql uses psql meta-commands (\if/\set/\gset); inline them for a single-session run
  const ws = (await one(owner, (c) => c.query("select gen_random_uuid() ws"))).rows[0].ws;
  const sql = fs.readFileSync(path.join(root, "db/seed/perf-seed.sql"), "utf8").split("\n")
    .filter((l) => !/^\\(if|set)\b/.test(l) && !/^SELECT gen_random_uuid\(\) AS ws \\gset/.test(l))
    .join("\n").replaceAll(":'ws'", `'${ws}'`).replaceAll(":'slug'", "'perf'").replaceAll(":issues", String(ISSUES));
  const t0 = Date.now(); await one(owner, (c) => c.query(sql));
  console.log(`seeded ${ISSUES} issues in ${((Date.now() - t0) / 1000).toFixed(1)}s, workspace ${ws}`);
  return { app: as("app_user", APP_PW), ws, drop };
  } catch (e) { await drop().catch(() => {}); throw e; } // no half-built scratch DB or roles left behind
}

const SEL = `select i.*, t.key as team_key, coalesce((select array_agg(label_id order by label_id) from issue_labels where issue_id = i.id), '{}') as label_ids,
  i.due_date::text as due_date_text,
  (select count(*) from issues c where c.parent_id = i.id and c.deleted_at is null) as sub_total,
  (select count(*) from issues c where c.parent_id = i.id and c.deleted_at is null and c.status = 'done') as sub_done
  from issues i join teams t on t.id = i.team_id and t.workspace_id = i.workspace_id where i.deleted_at is null and i.archived_at is null`;
const ORD = "order by i.sort_key asc, i.id asc limit 51";

async function bench(appUrl, ws) {
  const c = new pg.Client({ connectionString: appUrl }); await c.connect();
  const tx = async (fn) => { await c.query("begin"); try { await c.query("select set_config('app.workspace_id',$1,true)", [ws]); return await fn(); } finally { await c.query("rollback"); } };
  const val = async (q) => (await tx(() => c.query(q))).rows[0]?.v;
  const MEMBER = await val("select user_id v from memberships where role='member' order by user_id limit 1");
  const GUEST = await val("select user_id v from memberships where role='guest' order by user_id limit 1");
  const TEAM = await val("select id v from teams order by key limit 1");
  const PROJ = await val("select project_id v from issues where project_id is not null group by 1 order by count(*) desc limit 1");
  const CYC = await val("select cycle_id v from issues where cycle_id is not null group by 1 order by count(*) desc limit 1");
  const LBL = await val("select label_id v from issue_labels group by 1 order by count(*) desc limit 1");
  const nIssues = await val("select count(*)::int v from issues");
  const mv = `and exists (select 1 from team_memberships tm where tm.team_id = i.team_id and tm.user_id = '${MEMBER}')`;
  const gv = `and exists (select 1 from issue_shares s where s.issue_id = i.id and s.guest_user_id = '${GUEST}' and s.revoked_at is null)`;
  const shapes = {
    admin_all: `${SEL} ${ORD}`,
    member_all: `${SEL} ${mv} ${ORD}`,
    guest_shared: `${SEL} ${gv} ${ORD}`,
    admin_team: `${SEL} and i.team_id='${TEAM}' ${ORD}`,
    admin_team_status: `${SEL} and i.team_id='${TEAM}' and i.status='todo' ${ORD}`,
    board_column_status: `${SEL} and i.status='in_progress' ${ORD}`,
    admin_project: `${SEL} and i.project_id='${PROJ}' ${ORD}`,
    admin_cycle: `${SEL} and i.cycle_id='${CYC}' ${ORD}`,
    admin_label: `${SEL} and exists (select 1 from issue_labels l where l.issue_id = i.id and l.label_id = '${LBL}') ${ORD}`,
    admin_assignee: `${SEL} and i.assignee_id='${MEMBER}' ${ORD}`,
    admin_page_deep: `${SEL} and (i.sort_key, i.id) > ((select sort_key from issues order by sort_key offset 4000 limit 1) collate "C", '00000000-0000-0000-0000-000000000000'::uuid) ${ORD}`,
  };
  const results = [];
  for (const [name, q] of Object.entries(shapes)) {
    const ts = []; let rows = 0, plan = "";
    await tx(async () => {
      await c.query(`explain (analyze) ${q}`); // warm cache
      for (let i = 0; i < RUNS; i++) {
        const r = (await c.query(`explain (analyze, format json) ${q}`)).rows[0]["QUERY PLAN"][0];
        ts.push(r["Execution Time"]); rows = r.Plan["Actual Rows"];
        const nodes = []; const walk = (p) => { if (/Scan/.test(p["Node Type"])) nodes.push(p["Node Type"].replace(" Scan", "") + (p["Index Name"] ? `:${p["Index Name"]}` : "")); (p.Plans ?? []).forEach(walk); };
        walk(r.Plan); plan = nodes.slice(0, 3).join(" > ");
      }
    });
    ts.sort((a, b) => a - b);
    const median = ts[Math.floor(ts.length / 2)], max = thresholds.shapes[name] ?? thresholds.default_ms;
    results.push({ shape: name, median_ms: +median.toFixed(2), worst_ms: +ts[ts.length - 1].toFixed(2), threshold_ms: max, rows, pass: median <= max && rows > 0, plan });
  }
  await c.end();
  return { nIssues, runs: RUNS, results };
}

let ctx = null;
try {
  ctx = flag("setup") ? await setup() : { app: process.env.DATABASE_URL, ws: process.env.WS_ID };
  if (!ctx.app || !ctx.ws) throw new Error("need DATABASE_URL + WS_ID (or --setup with PGSUPER_URL)");
  const out = await bench(ctx.app, ctx.ws);
  console.log(`\nissues=${out.nIssues} runs=${out.runs} (median execution ms, EXPLAIN ANALYZE, app_user + RLS)`);
  console.log("shape".padEnd(22), "median".padStart(8), "worst".padStart(8), "limit".padStart(7), "rows".padStart(5), " ok   plan");
  for (const r of out.results) console.log(r.shape.padEnd(22), String(r.median_ms).padStart(8), String(r.worst_ms).padStart(8), String(r.threshold_ms).padStart(7), String(r.rows).padStart(5), r.pass ? " ok   " : " FAIL ", r.plan);
  const json = arg("json", ""); if (json) fs.writeFileSync(json, JSON.stringify(out, null, 2));
  const bad = out.results.filter((r) => !r.pass);
  if (bad.length) { console.error(`\nPERF GATE FAILED: ${bad.map((b) => b.shape).join(", ")}`); process.exitCode = 1; } else console.log("\nPERF GATE OK");
} finally { if (ctx?.drop && !flag("keep")) await ctx.drop(); }

/* global console, process */
// Prints a markdown coverage summary (total + critical paths) for the CI step summary.
// Non-blocking: thresholds only emit ::warning annotations, the exit code is always 0.
import { readFileSync, existsSync } from "node:fs";
const FILE = "coverage/coverage-summary.json";
const MIN = { total: 60, critical: 80 }; // lines %, ratchet up over time
const CRITICAL = [/src\/lib\/auth\//, /src\/lib\/http\/(ctx|cursor|validate)\.ts$/, /src\/lib\/issues/, /src\/lib\/resources\/tenancy\.ts$/];
if (!existsSync(FILE)) { console.log("No coverage summary found (tests did not run)."); process.exit(0); }
const s = JSON.parse(readFileSync(FILE, "utf8"));
const rel = (k) => k.slice(k.indexOf("src/"));
const pct = (m) => `${m.pct}% (${m.covered}/${m.total})`;
const out = ["## Coverage", "", "| Scope | Lines | Branches | Functions |", "|---|---|---|---|"];
out.push(`| **total** | ${pct(s.total.lines)} | ${pct(s.total.branches)} | ${pct(s.total.functions)} |`);
const warn = [];
if (s.total.lines.pct < MIN.total) warn.push(`total lines ${s.total.lines.pct}% < ${MIN.total}%`);
for (const [k, v] of Object.entries(s)) {
  if (k === "total" || !CRITICAL.some((r) => r.test(k))) continue;
  out.push(`| ${rel(k)} | ${pct(v.lines)} | ${pct(v.branches)} | ${pct(v.functions)} |`);
  if (v.lines.pct < MIN.critical) warn.push(`${rel(k)} lines ${v.lines.pct}% < ${MIN.critical}%`);
}
console.log(out.join("\n"));
for (const w of warn) console.error(`::warning title=coverage::${w}`);

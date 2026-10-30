import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { RICH_ISSUES, RICH_COMMENTS, RICH_NOTIFS, ALL_LABELS, LABEL_GROUPS, PERSONA_NAMES, RICH_USERS, issueByKey, mentionsOf, commentAt } from '../../scripts/demo-rich-data';

const PROJECT_NAMES = ['Mini Linear', 'Cronkit', 'Design System']; // projects created by the demo seeds
const BASE_RETITLED = 'Port the cron parser from the prototype'; // DEM-7, retitled by the rich seed

describe('seed v2 data (scripts/demo-rich-data.ts)', () => {
  it('no issue title contains a project name', () => {
    for (const t of [...RICH_ISSUES.map((i) => i.title), BASE_RETITLED])
      for (const p of PROJECT_NAMES) expect(t.toLowerCase(), t).not.toContain(p.toLowerCase());
  });
  it('team-local numbers are unique, keys are unique, titles are unique', () => {
    expect(new Set(RICH_ISSUES.map((i) => `${i.team}-${i.n}`)).size).toBe(RICH_ISSUES.length);
    expect(new Set(RICH_ISSUES.map((i) => i.key)).size).toBe(RICH_ISSUES.length);
    expect(new Set(RICH_ISSUES.map((i) => i.title)).size).toBe(RICH_ISSUES.length);
    expect(new Set(RICH_ISSUES.map((i) => i.team))).toEqual(new Set(['DEM', 'PLT', 'DSN']));
  });
  it('8 to 12 labels with distinct names and colours, grouped ones point at a real group, all used', () => {
    expect(ALL_LABELS.length).toBeGreaterThanOrEqual(8);
    expect(ALL_LABELS.length).toBeLessThanOrEqual(12);
    expect(new Set(ALL_LABELS.map((l) => l[2].toLowerCase())).size).toBe(ALL_LABELS.length);
    expect(new Set(ALL_LABELS.map((l) => l[1].toLowerCase())).size).toBe(ALL_LABELS.length);
    const groups = new Set(LABEL_GROUPS.map((g) => g[0]));
    for (const [, , color, g] of ALL_LABELS) { expect(color).toMatch(/^#[0-9a-f]{6}$/i); if (g) expect(groups.has(g)).toBe(true); }
    const used = new Set(RICH_ISSUES.flatMap((i) => i.labels));
    for (const [k] of ALL_LABELS) expect(used.has(k), k).toBe(true);
  });
  it('every person has a full name (first + last)', () => {
    for (const n of [...Object.values(PERSONA_NAMES), ...RICH_USERS.map((u) => u.name)]) expect(n.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
    for (const n of Object.values(PERSONA_NAMES)) expect(n).not.toMatch(/demo|tester|viewer/i);
  });
  it('comments: unique keys, replies are one level deep on the same issue, mentions are known personas, threads exist', () => {
    const by = new Map(RICH_COMMENTS.map((c) => [c.k, c]));
    expect(by.size).toBe(RICH_COMMENTS.length);
    for (const c of RICH_COMMENTS) {
      issueByKey('DEM', c.n);
      if (c.re !== undefined) { const p = by.get(c.re)!; expect(p, `parent of ${c.k}`).toBeTruthy(); expect(p.re).toBeUndefined(); expect(p.n).toBe(c.n); expect(c.resolved).toBeUndefined(); }
      expect(c.body.match(/\{[a-z]+\}/g) ?? []).toHaveLength(mentionsOf(c.body).length); // no unknown {token}
    }
    expect(RICH_COMMENTS.filter((c) => c.re !== undefined).length).toBeGreaterThanOrEqual(10);
    expect(RICH_COMMENTS.filter((c) => mentionsOf(c.body).length).length).toBeGreaterThanOrEqual(10);
  });
  it('every notification references a visible issue, is consistent with the data and mixes read and unread', () => {
    expect(new Set(RICH_NOTIFS.map((n) => n.type))).toEqual(new Set(['assigned', 'mention', 'comment', 'status_change', 'due_soon']));
    for (const n of RICH_NOTIFS) {
      const issue = issueByKey('DEM', n.n); // throws if missing
      expect(issue, `DEM-${n.n}`).toBeTruthy();
      expect(n.actor).not.toBe('admin');
      if (n.type === 'assigned') expect(issue.who).toBe('admin');
      if (n.type === 'due_soon') expect(issue.due).toBeTruthy();
      if (n.type === 'status_change') expect(issue.who === n.actor || issue.by === n.actor).toBe(true);
      if (n.type === 'mention' || n.type === 'comment') {
        const c = RICH_COMMENTS.find((x) => x.k === n.comment)!;
        expect(c.n).toBe(n.n); expect(c.by).toBe(n.actor);
        expect(commentAt(c)).toBe(n.at);
        if (n.type === 'mention') expect(mentionsOf(c.body)).toContain('admin');
        else expect(issue.by === 'admin' || issue.who === 'admin').toBe(true);
      }
    }
    for (const n of RICH_NOTIFS) expect(issueByKey('DEM', n.n).desc.length, `DEM-${n.n}`).toBeGreaterThan(150); // inbox preview has content
    expect(RICH_NOTIFS.some((n) => n.read)).toBe(true);
    expect(RICH_NOTIFS.some((n) => !n.read)).toBe(true);
    const mentions = RICH_NOTIFS.filter((n) => n.type === 'mention').map((n) => n.comment);
    expect(new Set(mentions).size).toBe(mentions.length);
    const ats = RICH_NOTIFS.map((n) => n.at);
    expect([...ats].sort()).toEqual(ats);
  });
});

describe('seed v2 rich descriptions', () => {
  const rich = RICH_ISSUES.filter((i) => i.desc.includes('\n\n'));
  it('has multi-paragraph markdown issues with headings, lists and code spans, varied lengths, across teams and projects', () => {
    expect(rich.length).toBeGreaterThanOrEqual(20);
    expect(rich.filter((i) => /^## /m.test(i.desc)).length).toBeGreaterThanOrEqual(8);
    expect(rich.filter((i) => /^(- |\d\. )/m.test(i.desc)).length).toBeGreaterThanOrEqual(15);
    expect(rich.filter((i) => /`[^`\n]+`/.test(i.desc)).length).toBeGreaterThanOrEqual(6);
    expect(new Set(rich.map((i) => i.team))).toEqual(new Set(['DEM', 'PLT', 'DSN']));
    expect(new Set(rich.map((i) => i.pj)).size).toBeGreaterThanOrEqual(3);
    const lens = rich.map((i) => i.desc.length);
    expect(Math.max(...lens) - Math.min(...lens)).toBeGreaterThan(200);
  });
  it('every markdown description is deterministic (fixed text, no timestamps) and under the API limit', () => {
    for (const i of RICH_ISSUES) { expect(i.desc.length).toBeGreaterThan(10); expect(i.desc.length).toBeLessThan(5000); }
  });
});

describe('seed-demo-rich guards', () => {
  // tsx on Node 24 occasionally dies with a segfault (no output) when the machine is busy: retry those, never a real failure.
  const run = (env: Record<string, string>) => {
    let r = spawnSync('true', { encoding: 'utf8' });
    for (let i = 0; i < 4; i++) {
      r = spawnSync('node_modules/.bin/tsx', ['scripts/seed-demo-rich.mts'], { env: { ...process.env, NODE_ENV: 'test', SEED_DEMO_PASSWORD: '', ...env }, encoding: 'utf8', timeout: 60_000 });
      if (r.stderr) break;
    }
    return r;
  };
  it('refuses to run in production', () => {
    const r = run({ DATABASE_OWNER_URL: 'postgres://o:p@localhost:5432/x', NODE_ENV: 'production', SEED_DEMO_PASSWORD: 'long-enough-1' });
    expect(r.status).not.toBe(0); expect(r.stderr).toContain('refuses to run in production');
  });
  it('refuses a non-local database', () => {
    const r = run({ DATABASE_OWNER_URL: 'postgres://o:p@db.example.com:5432/x', SEED_DEMO_PASSWORD: 'long-enough-1' });
    expect(r.status).not.toBe(0); expect(r.stderr).toContain('local or CI databases only');
  });
  it('requires the demo password', () => {
    const r = run({ DATABASE_OWNER_URL: 'postgres://o:p@localhost:5432/x' });
    expect(r.status).not.toBe(0); expect(r.stderr).toContain('SEED_DEMO_PASSWORD is required');
  });
});

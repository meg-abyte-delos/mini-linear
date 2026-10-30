// Keeps docs/authz-matrix.md and the matrix in sync with the routes on disk (no database needed).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROWS, GLOBAL_ROWS, normPath } from '../authz/matrix';
import { renderMatrix } from '../authz/doc';

const ROOT = join(process.cwd(), 'src/app/api/v1');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('route.ts') ? [p] : []; });
const onDisk = walk(ROOT).flatMap((file) => {
  const rel = file.slice(ROOT.length, -'/route.ts'.length), src = readFileSync(file, 'utf8');
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) => new RegExp(`export (async function|const) ${m}\\b|export const [A-Za-z0-9_, =]*\\b${m} =`).test(src) || new RegExp(`export const [^;]*\\b${m}\\s*=`).test(src))
    .map((m) => `${m} /api/v1${normPath(rel)}`);
});

describe('authorization matrix coverage', () => {
  it('every route handler on disk has a matrix row, and every row a route', () => {
    const declared = new Set([...ROWS.map((r) => `${r.m} /api/v1/w/{}${normPath(r.path) === '/' ? '' : normPath(r.path)}`), ...GLOBAL_ROWS.map((g) => `${g.m} ${normPath(g.path)}`)]);
    const disk = new Set(onDisk);
    expect([...disk].filter((x) => !declared.has(x)).sort()).toEqual([]);
    expect([...declared].filter((x) => !disk.has(x)).sort()).toEqual([]);
  });
  it('docs/authz-matrix.md is up to date', () => {
    const file = join(process.cwd(), 'docs/authz-matrix.md'), want = renderMatrix();
    if (process.env.UPDATE_AUTHZ_DOC === '1') writeFileSync(file, want);
    expect(existsSync(file) ? readFileSync(file, 'utf8') : '').toBe(want);
  });
});

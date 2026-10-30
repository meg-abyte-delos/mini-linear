// Table-driven authorization matrix (lane A3): every route x role cell of tests/authz/matrix.ts is executed against the
// running app with real, freshly created resources. Denied cells must also leave the workspace's data untouched.
import { describe, it, expect, beforeAll } from 'vitest';
import { runIntegration } from './helpers/gate';
import { ROWS, GLOBAL_ROWS, rowId } from '../authz/matrix';
import { ROLES } from '../authz/roles';
import { build, runCell, okStatus, call, whoFor, type World } from '../authz/harness';

let W: World;
beforeAll(async () => { if (runIntegration) W = await build(); }, 120_000);

describe.runIf(runIntegration)('authorization matrix', () => {
  const only = process.env.AUTHZ_ONLY;
  for (const row of ROWS.filter((r) => !only || rowId(r).includes(only))) {
    it(rowId(row), async () => {
      const bad: string[] = [];
      for (const role of ROLES) {
        try {
          const c = await runCell(W, row, role);
          if (!okStatus(c)) bad.push(`${role}: want ${c.want === 'ok' || c.want === 'noop' ? row.ok : c.want} got ${c.got}`);
          if (c.fpChanged) bad.push(`${role}: ${c.want === 'noop' ? 'NO-OP' : 'DENIED'} (${c.got}) BUT DATA CHANGED`);
        } catch (e) { bad.push(`${role}: ${(e as Error).message}`); }
      }
      expect(bad, rowId(row)).toEqual([]);
    }, 120_000);
  }
});

describe.runIf(runIntegration)('authorization matrix: routes outside a workspace', () => {
  for (const g of GLOBAL_ROWS.filter((x) => x.kind === 'session')) {
    it(`${g.m} ${g.path}`, async () => {
      const bad: string[] = [];
      // every signed-in role gets the same answer: these routes do not depend on a workspace role
      for (const role of ['owner', 'admin', 'member', 'outsideTeam', 'guestShared', 'guestUnshared', 'otherWs'] as const) {
        const r = await call(whoFor(W, role), g.m, g.path, g.body);
        if (r.status !== g.session) bad.push(`${role}: want ${g.session} got ${r.status}`);
      }
      const k = await call(whoFor(W, 'roKey'), g.m, g.path, g.body);
      if (k.status !== g.key) bad.push(`roKey: want ${g.key} got ${k.status}`);
      const a = await call(null, g.m, g.path, g.body);
      if (a.status !== g.anon) bad.push(`anon: want ${g.anon} got ${a.status}`);
      expect(bad).toEqual([]);
    }, 60_000);
  }
});

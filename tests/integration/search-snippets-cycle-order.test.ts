import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, withWorkspace, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import { searchWorkspace } from "../../src/lib/search/handlers";
import { encodeCursor } from "../../src/lib/http/cursor";
import * as L from "../../src/lib/resources/labels-cycles";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
type Hit = { id: string; kind: string; title: string; snippet: string };

(haveDb ? describe : describe.skip)("search snippets are plain text; cycles list newest past first", { timeout: 60000 }, () => {
  const owner = ownerSql(); let seed: Seed; let team = "";
  const issueId = randomUUID(), projId = randomUUID();
  const search = async (q: string) => {
    setSessionResolver(async () => seed.a.admin);
    const r = await searchWorkspace(new Request(`http://localhost/api/v1/w/${seed.a.slug}/search?q=${q}&limit=50`), seed.a.slug);
    const j = await r.json(); if (!j.items) throw new Error(JSON.stringify(j)); return j.items as Hit[];
  };
  const cycles = async (qs = "") => {
    setSessionResolver(async () => seed.a.admin);
    const r = await L.listCycles(new Request(`http://localhost/api/v1/w/${seed.a.slug}/cycles${qs}`), seed.a.slug);
    const j = await r.json(); if (!j.items) throw new Error(JSON.stringify(j)); return j as { items: { name: string }[]; next_cursor: string | null };
  };

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    team = randomUUID();
    await withWorkspace(owner, seed.a.id, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${seed.a.id}, 'Alpha', 'ALP')`;
      const desc = "Retry by email.\n\n## Behaviour\n\n- 5 attempts per minute\n- **quokka** limit with `code` and [a link](https://x.test)\n\n```ts\nconst a = 1;\n```\n> quoted line";
      await tx`insert into issues (id, workspace_id, team_id, number, title, description, sort_key, created_by) values (${issueId}, ${seed.a.id}, ${team}, 1, 'Rate limit quokka', ${desc}, 'a1', ${seed.a.admin})`;
      await tx`insert into projects (id, workspace_id, name, description) values (${projId}, ${seed.a.id}, 'Quokka project', '# Heading\n\n- *bold* quokka plan')`;
      await tx`insert into project_teams (workspace_id, project_id, team_id) values (${seed.a.id}, ${projId}, ${team})`;
      await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values
        (${randomUUID()}, ${seed.a.id}, ${team}, 'Past 1', '2020-01-01', '2020-01-14'),
        (${randomUUID()}, ${seed.a.id}, ${team}, 'Past 2', '2020-01-15', '2020-01-28'),
        (${randomUUID()}, ${seed.a.id}, ${team}, 'Past 3', '2020-02-01', '2020-02-14'),
        (${randomUUID()}, ${seed.a.id}, ${team}, 'Next 1', '2090-01-01', '2090-01-14'),
        (${randomUUID()}, ${seed.a.id}, ${team}, 'Next 2', '2090-02-01', '2090-02-14')`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("issue snippet: no markdown, no newlines, built from the description only", async () => {
    const h = (await search("quokka")).find((x) => x.id === issueId)!;
    expect(h.title).toBe("Rate limit quokka");
    expect(h.snippet).toContain("<mark>quokka</mark>");
    const plain = h.snippet.replace(/<\/?mark>/g, "");
    expect(plain).not.toMatch(/[#*`>\[\]\n]|\(https|```/);
    expect(plain.startsWith("Rate limit quokka")).toBe(false);
    const all = (await search("retry")).find((x) => x.id === issueId)!.snippet;
    expect(all).toMatch(/^<mark>Retry<\/mark> by email\. Behaviour\. 5 attempts per minute/);
  });

  it("a stripped heading or bold label keeps a separator (. or :), without doubling existing punctuation", async () => {
    const id = randomUUID();
    const desc = "## Behaviour\n- 5 attempts per minute\n**Scale** one to five\n## Done.\n**Note:** marmoset only\n**Solo**\nend";
    await withWorkspace(owner, seed.a.id, async (tx) => {
      await tx`insert into issues (id, workspace_id, team_id, number, title, description, sort_key, created_by) values (${id}, ${seed.a.id}, ${team}, 3, 'Separator check', ${desc}, 'a3', ${seed.a.admin})`;
    });
    const [row] = await owner<{ p: string }[]>`select search_plain(${desc}) as p`;
    const p = row!.p;
    expect(p).toBe("Behaviour. 5 attempts per minute Scale: one to five Done. Note: marmoset only Solo. end");
    const h = (await search("marmoset")).find((x) => x.id === id)!;
    expect(h.snippet.replace(/<\/?mark>/g, "")).toContain("Note: ");
  });

  it("project snippet is plain description text", async () => {
    const h = (await search("quokka")).find((x) => x.id === projId)!;
    expect(h.snippet.replace(/<\/?mark>/g, "")).toBe("Heading. bold quokka plan");
  });

  it("cycles: upcoming soonest first, then past cycles most recent first, cursor pages consistently", async () => {
    const names = (await cycles()).items.map((c) => c.name);
    expect(names).toEqual(["Next 1", "Next 2", "Past 3", "Past 2", "Past 1"]);
    const seen: string[] = []; let cur: string | null = null;
    do {
      const p = await cycles(`?limit=2${cur ? `&cursor=${encodeURIComponent(cur)}` : ""}`);
      seen.push(...p.items.map((c) => c.name)); cur = p.next_cursor;
    } while (cur);
    expect(seen).toEqual(names);
  });

  it("cycles: a validly signed cursor with a non numeric k is a 400 invalid cursor", async () => {
    setSessionResolver(async () => seed.a.admin);
    const cur = encodeCursor(seed.a.id, "cycles", { k: "abc", id: randomUUID() });
    const r = await L.listCycles(new Request(`http://localhost/api/v1/w/${seed.a.slug}/cycles?cursor=${encodeURIComponent(cur)}`), seed.a.slug);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).toContain("invalid cursor");
  });

  it("title-only match: found, flagged matched=title, snippet is the plain description head (no mark)", async () => {
    const id = randomUUID();
    await withWorkspace(owner, seed.a.id, async (tx) => {
      await tx`insert into issues (id, workspace_id, team_id, number, title, description, sort_key, created_by) values (${id}, ${seed.a.id}, ${team}, 2, 'Zebrafinch title', 'nothing relevant here', 'a2', ${seed.a.admin})`;
    });
    const h = (await search("zebrafinch")).find((x) => x.id === id);
    expect(h).toBeTruthy();
    expect((h as Hit & { matched: string[] }).matched).toEqual(["title"]);
    expect(h!.snippet).toBe("nothing relevant here");
  });
});

import { describe, it, expect } from "vitest";
import { teamSettingsApi, movePosition, sortStates, FORBIDDEN_MESSAGE, type WorkflowState } from "../../src/lib/team-settings-client";
const st = (id: string, category: WorkflowState["category"], position: number): WorkflowState => ({ id, team_id: "t", name: id, color: "#000000", category, position, version: 1 });
describe("team-settings client", () => {
  it("sends If-Match and maps 412/409/403 to user messages", async () => {
    const calls: [string, RequestInit][] = [];
    const mk = (status: number) => (async (u: string, i: RequestInit) => { calls.push([u, i]); return new Response(status === 204 ? null : "{}", { status }); }) as unknown as typeof fetch;
    const r412 = await teamSettingsApi("w 1", mk(412)).patchState(st("a", "started", 0), { name: "x" });
    expect(r412).toMatchObject({ ok: false, status: 412 });
    expect(calls[0]![0]).toBe("/api/v1/w/w%201/teams/t/states/a");
    expect((calls[0]![1].headers as Record<string, string>)["if-match"]).toBe('"1"');
    expect(await teamSettingsApi("w", mk(409)).createLabel({ name: "x" })).toMatchObject({ ok: false, message: "That name is already taken." });
    expect(await teamSettingsApi("w", mk(403)).createGroup({ name: "x" })).toMatchObject({ ok: false, status: 403, message: FORBIDDEN_MESSAGE });
    expect(FORBIDDEN_MESSAGE).not.toMatch(/^Only workspace admins/);
    expect(await teamSettingsApi("w", mk(204)).deleteLabel({ id: "l", team_id: null, group_id: null, name: "l", color: "#000000", description: "", version: 3 })).toEqual({ ok: true, data: undefined });
    await teamSettingsApi("w", mk(204)).deleteState(st("a", "started", 0), "r 1");
    expect(calls.at(-1)![0]).toBe("/api/v1/w/w/teams/t/states/a?replacement_id=r%201");
    const boom = (async () => { throw new Error("x"); }) as unknown as typeof fetch;
    expect(await teamSettingsApi("w", boom).listStates("t")).toMatchObject({ ok: false, status: 0 });
  });
  it("movePosition picks a midpoint inside the category", () => {
    const s = [st("b", "backlog", 1), st("p1", "started", 2), st("p2", "started", 4), st("p3", "started", 6), st("d", "completed", 8)];
    expect(movePosition(s, "p3", -1)).toBe(3);
    expect(movePosition(s, "p2", -1)).toBe(1);
    expect(movePosition(s, "p1", 1)).toBe(5);
    expect(movePosition(s, "p3", 1)).toBeNull();
    expect(movePosition(s, "p1", -1)).toBeNull();
    expect(movePosition(s, "zz", 1)).toBeNull();
  });
  it("sortStates orders by category then position", () => {
    expect(sortStates([st("d", "completed", 0), st("b", "started", 2), st("a", "backlog", 9), st("c", "started", 1)]).map((x) => x.id)).toEqual(["a", "c", "b", "d"]);
  });
});

// Browser-side calls for team settings + labels. Pure over an injectable fetch so it is unit-testable.
// Workflow states use main's API (/teams/:id/states, 0101) and cycle config /teams/:id/cycle-settings (0301).
import type { EstimateScale } from "./team-config";

export const CATEGORIES = ["backlog", "unstarted", "started", "completed", "canceled"] as const;
export type StateCategory = (typeof CATEGORIES)[number];
export type WorkflowState = { id: string; team_id: string; name: string; color: string; category: StateCategory; position: number; version: number };
export type TeamSettings = { team_id: string; estimate_scale: EstimateScale; estimate_allow_zero: boolean; version: number };
export type CycleSettings = { team_id: string; enabled: boolean; duration_days: number; cooldown_days: number; start_weekday: number; upcoming_count: number; auto_rollover: boolean; version: number };
export type LabelGroup = { id: string; team_id: string | null; name: string; color: string; version: number };
export type Label = { id: string; team_id: string | null; group_id: string | null; name: string; color: string; description: string; version: number };
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export const FORBIDDEN_MESSAGE = "Only team admins or workspace admins can change this.";

type Fetch = typeof fetch;
export function teamSettingsApi(slug: string, f: Fetch = fetch) {
  const base = `/api/v1/w/${encodeURIComponent(slug)}`;
  async function req<T>(method: string, path: string, body?: unknown, version?: number): Promise<Result<T>> {
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (version !== undefined) headers["if-match"] = `"${version}"`;
      const res = await f(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.status === 204) return { ok: true, data: undefined as T };
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) return { ok: true, data: j as T };
      const msg = res.status === 412 ? "Someone else changed this. Reload and try again." : res.status === 409 ? String((j.error as { message?: string } | undefined)?.message ?? "That name is already taken.")
        : res.status === 403 ? FORBIDDEN_MESSAGE : String((j.error as { message?: string } | undefined)?.message ?? "Request failed");
      return { ok: false, status: res.status, message: msg };
    } catch { return { ok: false, status: 0, message: "Network error" }; }
  }
  const t = (team: string) => `/teams/${encodeURIComponent(team)}`;
  return {
    listStates: (team: string) => req<{ items: WorkflowState[] }>("GET", `${t(team)}/states`),
    createState: (team: string, b: Pick<WorkflowState, "name" | "category"> & Partial<Pick<WorkflowState, "color" | "position">>) => req<WorkflowState>("POST", `${t(team)}/states`, b),
    patchState: (s: WorkflowState, b: Partial<Pick<WorkflowState, "name" | "color" | "category" | "position">>) => req<WorkflowState>("PATCH", `${t(s.team_id)}/states/${s.id}`, b, s.version),
    /** A state used by issues needs a replacement (409 otherwise). */
    deleteState: (s: WorkflowState, replacementId?: string) => req<void>("DELETE", `${t(s.team_id)}/states/${s.id}${replacementId ? `?replacement_id=${encodeURIComponent(replacementId)}` : ""}`, undefined, s.version),
    getSettings: (team: string) => req<TeamSettings>("GET", `${t(team)}/settings`),
    patchSettings: (s: TeamSettings, b: Partial<Omit<TeamSettings, "team_id" | "version">>) => req<TeamSettings>("PATCH", `${t(s.team_id)}/settings`, b, s.version),
    getCycleSettings: (team: string) => req<CycleSettings>("GET", `${t(team)}/cycle-settings`),
    putCycleSettings: (s: CycleSettings, b: Partial<Omit<CycleSettings, "team_id" | "version">>) => req<CycleSettings>("PUT", `${t(s.team_id)}/cycle-settings`, b, s.version),
    listGroups: (team?: string) => req<{ items: LabelGroup[] }>("GET", `/label-groups?limit=100${team ? `&team_id=${team}` : ""}`),
    createGroup: (b: { name: string; color?: string; team_id?: string | null }) => req<LabelGroup>("POST", "/label-groups", b),
    deleteGroup: (g: LabelGroup) => req<void>("DELETE", `/label-groups/${g.id}`, undefined, g.version),
    listLabels: (team?: string) => req<{ items: Label[] }>("GET", `/labels?limit=100${team ? `&team_id=${team}` : ""}`),
    createLabel: (b: { name: string; color?: string; team_id?: string | null; group_id?: string | null; description?: string }) => req<Label>("POST", "/labels", b),
    patchLabel: (l: Label, b: Partial<Pick<Label, "name" | "color" | "group_id" | "description">>) => req<Label>("PATCH", `/labels/${l.id}`, b, l.version),
    deleteLabel: (l: Label) => req<void>("DELETE", `/labels/${l.id}`, undefined, l.version),
  };
}
/** New position for moving a state one step up/down inside its category (positions are doubles: midpoint), or null. */
export function movePosition(states: WorkflowState[], id: string, dir: -1 | 1): number | null {
  const s = states.find((x) => x.id === id); if (!s) return null;
  const same = states.filter((x) => x.category === s.category).sort((a, b) => a.position - b.position);
  const i = same.findIndex((x) => x.id === id), j = i + dir;
  if (j < 0 || j >= same.length) return null;
  const other = same[j]!, beyond = same[j + dir];
  return beyond ? (other.position + beyond.position) / 2 : other.position + dir;
}
/** States grouped the way Linear shows them: by category, then position. */
export const sortStates = <T extends { category: string; position: number }>(s: T[]): T[] =>
  [...s].sort((a, b) => CATEGORIES.indexOf(a.category as StateCategory) - CATEGORIES.indexOf(b.category as StateCategory) || a.position - b.position);

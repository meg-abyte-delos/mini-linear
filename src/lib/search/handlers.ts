import { z } from "zod";
import { withWorkspaceCtx, db } from "../http/ctx";
import { ApiError, errorResponse } from "../http/errors";
import { decodeCursor, page } from "../http/cursor";
import { listQuery, parseQuery, uuidSchema } from "../http/validate";
import { hit } from "../auth/ratelimit";

const STATUS = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] as const;
const KINDS = ["issue", "comment", "project", "attachment"] as const;
const DEFAULT_KINDS = ["issue", "comment", "project"] as const; // attachments are opt-in (kind=attachment)
export const SEARCH_RATE_LIMIT = () => Number(process.env.SEARCH_RATE_LIMIT ?? 120);

// A NUL byte cannot be stored in or compared against Postgres text: refuse it as a validation error, never a 500.
const noNul = (s: string) => !s.includes("\u0000");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s); }, "invalid date");
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const kindList = z.string().transform((s, ctx) => {
  const parts = [...new Set(s.split(",").map((x) => x.trim()))];
  if (parts.length === 0 || parts.some((p) => !(KINDS as readonly string[]).includes(p))) { ctx.addIssue({ code: "custom", message: `kind must be a comma list of ${KINDS.join("|")}` }); return z.NEVER; }
  return parts;
});
const query = listQuery.extend({
  q: z.string().trim().min(1).max(200).refine(noNul, "q must not contain NUL"), kind: kindList.optional(), status: z.enum(STATUS).optional(), team_id: uuidSchema.optional(),
  assignee_id: uuidSchema.optional(), project_id: uuidSchema.optional(), label_id: uuidSchema.optional(),
  priority: z.string().regex(/^[0-4]$/).transform(Number).optional(), cycle_id: uuidSchema.optional(), state_id: uuidSchema.optional(),
  due_before: isoDate.optional(), due_after: isoDate.optional(), has_attachment: bool.optional(), include_done: bool.optional(),
  sort: z.enum(["rank", "updated"]).default("rank"),
});

type Row = { kind: string; id: string; issue_id: string | null; identifier: string | null; title: string; snippet: string; rank: number; status: string | null; team_id: string | null;
  project_id: string | null; assignee_id: string | null; updated_at: Date; parent_identifier: string | null; matched: string[]; updated_key: string };

/**
 * GET /search: all visibility (team membership, guest shares, soft-delete) is enforced inside search_workspace (0007, v3 in 0804),
 * before ranking and LIMIT, so pages are never short and the cursor never points past a hidden row.
 */
export const searchWorkspace = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const q = parseQuery(req, query);
  // Counted outside the request tx so a refused request still counts (the tx rolls back on throw).
  try { await hit(db(), `search:user:${ctx.userId}`, SEARCH_RATE_LIMIT(), 60); } catch (e) {
    if (!(e instanceof ApiError) || e.code !== "rate_limited") throw e;
    const res = errorResponse(e); // Retry-After: seconds until the fixed 60 s window rolls over
    res.headers.set("Retry-After", String(60 - (Math.floor(Date.now() / 1000) % 60)));
    return res;
  }
  const scope = `search:${q.sort}:desc`;
  const cur = q.cursor ? decodeCursor(q.cursor, ctx.workspaceId, scope) : null;
  const after = cur && q.sort === "rank" ? Number(cur.k) : null;
  const afterTs = cur && q.sort === "updated" ? cur.k : null;
  if (cur && q.sort === "rank" && !Number.isFinite(after)) throw new ApiError("bad_request", "invalid cursor");
  if (afterTs !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(afterTs)) throw new ApiError("bad_request", "invalid cursor");
  const kinds = q.kind ?? [...DEFAULT_KINDS];
  const rows = await ctx.tx<Row[]>`select * from search_workspace(${q.q}, ${kinds}::text[], ${q.limit + 1},
    ${q.status ?? null}::issue_status, ${q.team_id ?? null}::uuid, ${q.assignee_id ?? null}::uuid, ${q.project_id ?? null}::uuid, ${q.label_id ?? null}::uuid,
    ${after}::float8, ${cur?.id ?? null}::uuid, ${q.priority ?? null}::smallint, ${q.cycle_id ?? null}::uuid, ${q.state_id ?? null}::uuid,
    ${q.due_before ?? null}::date, ${q.due_after ?? null}::date, ${q.has_attachment ?? null}::boolean, ${q.include_done ?? true}::boolean,
    ${q.sort}::text, ${afterTs}::text::timestamptz)`;
  const p = page(rows, q.limit, ctx.workspaceId, scope, (r) => ({ k: q.sort === "updated" ? r.updated_key : String(r.rank), id: r.id }));
  return Response.json({ items: p.items.map((r) => { const o: Partial<Row> = { ...r }; delete o.updated_key; return o; }), next_cursor: p.next_cursor });
});

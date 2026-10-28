import { z } from "zod";
import { withWorkspaceCtx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { decodeCursor, page } from "../http/cursor";
import { listQuery, parseQuery, uuidSchema } from "../http/validate";

const SCOPE = "search:rank:desc";
const STATUS = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] as const;
const KINDS = ["issue", "comment", "project"] as const;
const query = listQuery.extend({
  q: z.string().trim().min(1).max(200), kind: z.enum(KINDS).optional(), status: z.enum(STATUS).optional(), team_id: uuidSchema.optional(),
  assignee_id: uuidSchema.optional(), project_id: uuidSchema.optional(), label_id: uuidSchema.optional(),
});

type Row = { kind: string; id: string; issue_id: string | null; identifier: string | null; title: string; snippet: string; rank: number; status: string | null; team_id: string | null; project_id: string | null; assignee_id: string | null };

/**
 * GET /search: all visibility (team membership, guest shares, soft-delete) is enforced inside search_workspace (0007),
 * before ranking and LIMIT, so pages are never short and the cursor never points past a hidden row.
 */
export const searchWorkspace = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const q = parseQuery(req, query);
  const cur = q.cursor ? decodeCursor(q.cursor, ctx.workspaceId, SCOPE) : null;
  const after = cur ? Number(cur.k) : null;
  if (cur && !Number.isFinite(after)) throw new ApiError("bad_request", "invalid cursor");
  const kinds = q.kind ? [q.kind] : [...KINDS];
  const rows = await ctx.tx<Row[]>`select * from search_workspace(${ctx.role}, ${ctx.userId}::uuid, ${q.q}, ${kinds}::text[], ${q.limit + 1},
    ${q.status ?? null}::issue_status, ${q.team_id ?? null}::uuid, ${q.assignee_id ?? null}::uuid, ${q.project_id ?? null}::uuid, ${q.label_id ?? null}::uuid,
    ${after}::float8, ${cur?.id ?? null}::uuid)`;
  const p = page(rows, q.limit, ctx.workspaceId, SCOPE, (r) => ({ k: String(r.rank), id: r.id }));
  return Response.json({ items: p.items, next_cursor: p.next_cursor });
});

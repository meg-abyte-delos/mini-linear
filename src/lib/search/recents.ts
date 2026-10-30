import { z } from "zod";
import { withWorkspaceCtx } from "../http/ctx";
import type { Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { parseJson, uuidSchema } from "../http/validate";
import { uuidv7 } from "../uuid7";

const KEEP = 50, MAX_LIST = 20;
type Rec = { id: string; kind: "query" | "issue" | "project"; query: string | null; entity_id: string | null; created_at: Date };

const body = z.strictObject({
  kind: z.enum(["query", "issue", "project"]),
  query: z.string().trim().min(1).max(200).refine((s) => !s.includes("\u0000"), "query must not contain NUL").optional(),
  entity_id: uuidSchema.optional(),
}).superRefine((b, c) => {
  if (b.kind === "query") {
    if (b.query === undefined) c.addIssue({ code: "custom", path: ["query"], message: "query is required for kind=query" });
    if (b.entity_id !== undefined) c.addIssue({ code: "custom", path: ["entity_id"], message: "entity_id is not allowed for kind=query" });
  } else {
    if (b.entity_id === undefined) c.addIssue({ code: "custom", path: ["entity_id"], message: "entity_id is required" });
    if (b.query !== undefined) c.addIssue({ code: "custom", path: ["query"], message: "query is only allowed for kind=query" });
  }
});

const visible = async (ctx: Ctx, kind: "issue" | "project", ids: string[]): Promise<Set<string>> => {
  if (ids.length === 0) return new Set();
  const r = await ctx.tx<{ id: string }[]>`select id from search_visible_entities(${kind}, ${ids}::uuid[])`;
  return new Set(r.map((x) => x.id));
};

/** GET /search/recents: newest first, max 20; entities the caller can no longer see are dropped. */
export const listRecents = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const rows = await ctx.tx<Rec[]>`select id, kind, query, entity_id, created_at from search_recents where user_id = ${ctx.userId} order by created_at desc, id desc limit ${KEEP}`;
  const ok = {
    issue: await visible(ctx, "issue", rows.filter((r) => r.kind === "issue").map((r) => r.entity_id!)),
    project: await visible(ctx, "project", rows.filter((r) => r.kind === "project").map((r) => r.entity_id!)),
  };
  const items = rows.filter((r) => r.kind === "query" || ok[r.kind].has(r.entity_id!)).slice(0, MAX_LIST);
  return Response.json({ items });
});

/** POST /search/recents: re-adding the same query / entity moves it to the top; keeps the 50 newest per user. */
export const addRecent = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const b = await parseJson(req, body);
  if (ctx.role === "guest" && b.kind === "project") throw new ApiError("forbidden");
  if (b.kind !== "query" && !(await visible(ctx, b.kind, [b.entity_id!])).has(b.entity_id!)) throw new ApiError("not_found");
  if (b.kind === "query") await ctx.tx`delete from search_recents where user_id = ${ctx.userId} and kind = 'query' and lower(query) = lower(${b.query!})`;
  else await ctx.tx`delete from search_recents where user_id = ${ctx.userId} and kind = ${b.kind} and entity_id = ${b.entity_id!}`;
  const id = uuidv7();
  const [row] = await ctx.tx<Rec[]>`insert into search_recents (id, workspace_id, user_id, kind, query, entity_id, created_at)
    values (${id}, ${ctx.workspaceId}, ${ctx.userId}, ${b.kind}, ${b.query ?? null}, ${b.entity_id ?? null}, clock_timestamp())
    returning id, kind, query, entity_id, created_at`;
  await ctx.tx`delete from search_recents where user_id = ${ctx.userId} and id not in (
    select id from search_recents where user_id = ${ctx.userId} order by created_at desc, id desc limit ${KEEP})`;
  return Response.json(row, { status: 201 });
});

export const clearRecents = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  await ctx.tx`delete from search_recents where user_id = ${ctx.userId}`;
  return new Response(null, { status: 204 });
});

/** Idempotent: unknown or foreign (RLS) ids are 204 too (malformed: 400). */
export const deleteRecent = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const r = uuidSchema.safeParse(rawId);
  if (!r.success) throw new ApiError("bad_request", "id must be a uuid");
  await ctx.tx`delete from search_recents where user_id = ${ctx.userId} and id = ${r.data}`;
  return new Response(null, { status: 204 });
});

import { z } from "zod";
import { withWorkspaceCtx, requireRole, atLeast, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { decodeCursor, page } from "../http/cursor";
import { listQuery, parseId, parseJson, parseQuery } from "../http/validate";
import { recordAudit, diffOf, type Diff } from "../audit";
import { uuidv7 } from "../uuid7";
import { load } from "./handlers";

type Row = Record<string, unknown>;

// ------------------------------------------------ attachments
const ATT_F = ["kind", "url", "title", "mime_type", "size_bytes"];
/** http(s) only: rejects javascript:, data:, file:, credentials in the URL and whitespace. */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new ApiError("validation_failed", "url must be an absolute http(s) URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ApiError("validation_failed", "url must use http or https");
  if (u.username || u.password) throw new ApiError("validation_failed", "url must not embed credentials");
  if (!u.hostname) throw new ApiError("validation_failed", "url must have a host");
  const s = u.toString();
  if (s.length > 2048) throw new ApiError("validation_failed", "url too long");
  return s;
}
/** Title when none is given: file => last path segment; link => host + path (no query), trimmed to 255. */
export function autoTitle(url: string, kind: "link" | "file"): string {
  const u = new URL(url);
  const seg = u.pathname.split("/").filter(Boolean);
  let t: string;
  const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
  if (kind === "file" && seg.length) t = dec(seg[seg.length - 1]!);
  else t = u.hostname.replace(/^www\./, "") + (seg.length ? "/" + seg.map(dec).join("/") : "");
  t = t.replace(/\s+/g, " ").trim();
  return (t || u.hostname).slice(0, 255);
}
const attBody = z.object({
  kind: z.enum(["link", "file"]).default("link"), url: z.string().min(1).max(2048),
  title: z.string().trim().min(1).max(255).optional(),
  mime_type: z.string().max(255).regex(/^[\w.+-]+\/[\w.+-]+$/).optional(), size_bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().refine((b) => b.kind === "file" || (b.mime_type === undefined && b.size_bytes === undefined), { message: "mime_type/size_bytes only for kind=file" });
const attDto = (r: Row) => ({ id: r.id, issue_id: r.issue_id, kind: r.kind, url: r.url, title: r.title, mime_type: r.mime_type ?? null,
  size_bytes: r.size_bytes == null ? null : Number(r.size_bytes), created_by: r.created_by, created_at: r.created_at });
const ATSEL = (ctx: Ctx) => ctx.tx`select id, issue_id, kind, url, title, mime_type, size_bytes, created_by, created_at, created_at::text as _k from issue_attachments`;
const audit = (ctx: Ctx, entity: string, id: string, action: string, diff: Diff) =>
  recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity, entityId: id, action, diff });

export const listAttachments = (req: Request, slug: string, rawIssue: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const issueId = parseId(rawIssue), q = parseQuery(req, listQuery), scope = `attachments:${issueId}`;
  await load(ctx, issueId); // 404 when hidden (team / guest share)
  const c = q.cursor ? decodeCursor(q.cursor, ctx.workspaceId, scope) : null, t = ctx.tx;
  const rows = await t<Row[]>`${ATSEL(ctx)} where issue_id = ${issueId} ${c ? t`and (created_at, id) > (${c.k}::text::timestamptz, ${c.id}::uuid)` : t``}
    order by created_at, id limit ${q.limit + 1}`;
  const p = page(rows, q.limit, ctx.workspaceId, scope, (r) => ({ k: r._k as string, id: r.id as string }));
  return Response.json({ items: p.items.map(attDto), next_cursor: p.next_cursor });
});

export const createAttachment = (req: Request, slug: string, rawIssue: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member"); // guests are read-only
  const issueId = parseId(rawIssue), b = await parseJson(req, attBody);
  await load(ctx, issueId);
  const url = normalizeUrl(b.url), title = b.title ?? autoTitle(url, b.kind), id = uuidv7();
  const n = await ctx.tx`select count(*)::int as n from issue_attachments where issue_id = ${issueId}`;
  if ((n[0]!.n as number) >= 500) throw new ApiError("validation_failed", "too many attachments on this issue (max 500)");
  await ctx.tx`insert into issue_attachments (id, workspace_id, issue_id, kind, url, title, mime_type, size_bytes, created_by)
    values (${id}, ${ctx.workspaceId}, ${issueId}, ${b.kind}, ${url}, ${title}, ${b.mime_type ?? null}, ${b.size_bytes ?? null}, ${ctx.userId})`;
  const row = (await ctx.tx<Row[]>`${ATSEL(ctx)} where id = ${id}`)[0]!;
  const dto = attDto(row);
  await audit(ctx, "attachment", id, "create", { ...diffOf(null, dto, ATT_F), issue_id: { before: null, after: issueId } });
  return Response.json(dto, { status: 201, headers: { Location: `/api/v1/w/${slug}/issues/${issueId}/attachments/${id}` } });
});

export const deleteAttachment = (req: Request, slug: string, rawIssue: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const issueId = parseId(rawIssue), id = parseId(rawId);
  await load(ctx, issueId);
  const r = await ctx.tx<Row[]>`${ATSEL(ctx)} where id = ${id} and issue_id = ${issueId}`;
  if (!r[0]) throw new ApiError("not_found");
  if (r[0].created_by !== ctx.userId && !atLeast(ctx.role, "admin")) throw new ApiError("forbidden"); // creator or admin
  await ctx.tx`delete from issue_attachments where id = ${id}`;
  await audit(ctx, "attachment", id, "delete", { ...diffOf(attDto(r[0]), null, ATT_F), issue_id: { before: issueId, after: null } });
  return new Response(null, { status: 204 });
});

// ------------------------------------------------ activity
const LABEL: Record<string, string> = {
  title: "title", description: "description", status: "status", state_id: "state", priority: "priority", assignee_id: "assignee",
  project_id: "project", cycle_id: "cycle", parent_id: "parent", label_ids: "labels", estimate: "estimate", due_date: "due date",
  archived_at: "archived", deleted_at: "deleted", body: "comment",
};
const PRIORITY = ["No priority", "Urgent", "High", "Medium", "Low"];
const fmt = (field: string, v: unknown): string => {
  if (v === null || v === undefined || v === "") return "none";
  if (field === "priority" && typeof v === "number") return PRIORITY[v] ?? String(v);
  if (field === "status" && typeof v === "string") return v.replace(/_/g, " ");
  if (Array.isArray(v)) return v.length ? `${v.length}` : "none";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 77) + "..." : s;
};
export type Change = { field: string; label: string; before: unknown; after: unknown; text: string };
/** One readable line per changed field. Long text fields (description, comment body) are reported as "updated", not quoted. */
export function describeChanges(diff: Diff): Change[] {
  return Object.entries(diff ?? {}).filter(([f]) => f !== "issue_id" && !(f === "state_id" && diff && "status" in diff)).map(([f, { before, after }]) => {
    const label = LABEL[f] ?? f.replace(/_id$/, "").replace(/_/g, " ");
    let text: string;
    if (f === "description" || f === "body") text = `updated the ${label}`;
    else if (f === "label_ids") {
      const b = new Set((before as string[] | null) ?? []), a = new Set((after as string[] | null) ?? []);
      const add = [...a].filter((x) => !b.has(x)).length, rem = [...b].filter((x) => !a.has(x)).length;
      text = [add ? `added ${add} label${add > 1 ? "s" : ""}` : "", rem ? `removed ${rem} label${rem > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ") || "changed labels";
    } else if (before == null) text = `set ${label} to ${fmt(f, after)}`;
    else if (after == null) text = `cleared ${label} (was ${fmt(f, before)})`;
    else text = `changed ${label} from ${fmt(f, before)} to ${fmt(f, after)}`;
    // Rex #68: never expose raw description/comment bodies in the activity feed (guests, deleted comments).
    if (f === "description" || f === "body") return { field: f, label, before: null, after: null, text };
    return { field: f, label, before, after, text };
  });
}
export function summarize(entity: string, action: string, diff: Diff): string {
  const ch = describeChanges(diff);
  switch (`${entity}:${action}`) {
    case "issue:create": return "created the issue";
    case "issue:delete": return "deleted the issue";
    case "issue:restore": return "restored the issue";
    case "issue:archive": return "archived the issue";
    case "issue:unarchive": return "unarchived the issue";
    case "comment:create": return "commented";
    case "comment:update": return "edited a comment";
    case "comment:delete": return "deleted a comment";
    case "attachment:create": return `attached ${fmt("title", diff.title?.after)}`;
    case "attachment:delete": return `removed attachment ${fmt("title", diff.title?.before)}`;
  }
  if (entity === "issue" && action === "update") return ch.length ? ch.map((c) => c.text).join(", ") : "updated the issue";
  const noun = entity.replace(/^issue_/, "").replace(/_/g, " ");
  const verb = action === "create" ? "added" : action === "delete" ? "removed" : action === "update" ? "updated" : action;
  const kind = typeof diff.type?.after === "string" ? `${(diff.type.after as string).replace(/_/g, " ")} ` : typeof diff.type?.before === "string" ? `${(diff.type.before as string).replace(/_/g, " ")} ` : "";
  return `${verb} a ${kind}${noun}`;
}
const actQuery = listQuery.extend({ entity: z.enum(["issue", "comment", "attachment", "relation"]).optional() });

/**
 * GET /issues/:id/activity. The issue's own audit rows plus the rows of every child entity (comment, attachment, relation, ...)
 * whose create/delete diff carries issue_id (or related_issue_id) = this issue; later edits of such a child are matched by its entity_id.
 * Newest first, keyset on (created_at desc, id desc). Visible to whoever can see the issue (guests on a shared issue included).
 */
export const listActivity = (req: Request, slug: string, rawIssue: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const issueId = parseId(rawIssue), q = parseQuery(req, actQuery), scope = `activity:${issueId}`;
  const issue = await load(ctx, issueId);
  const c = q.cursor ? decodeCursor(q.cursor, ctx.workspaceId, scope) : null, t = ctx.tx;
  const ent = q.entity === "relation" ? t`and a.entity in ('relation', 'issue_relation')` : q.entity ? t`and a.entity = ${q.entity}` : t``;
  const rows = await t<Row[]>`with kids as (
      select distinct entity_id from audit_events
      where entity <> 'issue' and entity_id is not null and (diff->'issue_id'->>'after' = ${issueId} or diff->'issue_id'->>'before' = ${issueId}
        or diff->'related_issue_id'->>'after' = ${issueId} or diff->'related_issue_id'->>'before' = ${issueId}))
    select a.id, a.actor_id, a.entity, a.entity_id, a.action, a.diff, a.created_at, a.created_at::text as _k from audit_events a
    where ((a.entity = 'issue' and a.entity_id = ${issueId}) or (a.entity <> 'issue' and a.entity_id in (select entity_id from kids))) ${ent}
      ${c ? t`and (a.created_at, a.id) < (${c.k}::text::timestamptz, ${c.id}::uuid)` : t``}
    order by a.created_at desc, a.id desc limit ${q.limit + 1}`;
  const p = page(rows, q.limit, ctx.workspaceId, scope, (r) => ({ k: r._k as string, id: r.id as string }));
  // Guests never see the description history of other fields they cannot otherwise read; issue diffs only expose issue fields.
  const items = p.items.map((r) => {
    const diff = (r.diff ?? {}) as Diff;
    return { id: r.id, issue_id: issue.id, actor_id: r.actor_id, entity: r.entity, entity_id: r.entity_id, action: r.action,
      summary: summarize(r.entity as string, r.action as string, diff), changes: describeChanges(diff), created_at: r.created_at };
  });
  return Response.json({ items, next_cursor: p.next_cursor });
});

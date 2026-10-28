import { z } from "zod";
import { withWorkspaceCtx, requireRole, requireSession, atLeast, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { encodeCursor } from "../http/cursor";
import { listQuery, parseId, parseJson, parseQuery } from "../http/validate";
import { diffOf } from "../audit";
import { uuidv7 } from "../uuid7";
import { newApiKey } from "../integrations/apikey";
import { WEBHOOK_EVENTS, newWebhookSecret, webhookUrlError } from "../integrations/webhooks";
import { type Row, audit, listPage, afterId } from "./common";

const json = (r: unknown, status = 200) => Response.json(r, { status });

// ------------------------------------------------ personal API keys (session-only management)
const KSEL = (ctx: Ctx) => ctx.tx`select id, user_id, name, prefix, scope, expires_at, last_used_at, revoked_at, created_at from api_keys`;
const keyBody = z.object({ name: z.string().trim().min(1).max(100), scope: z.enum(["read", "write"]).default("write"), expires_in_days: z.number().int().min(1).max(3650).optional() }).strict();

/** Own keys; admins/owners may list every key of the workspace with ?all=1 (to audit and revoke). */
export const listApiKeys = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireSession(ctx);
  const q = parseQuery(req, listQuery.extend({ all: z.enum(["0", "1"]).optional() })), c = afterId(ctx, "api_keys", q);
  const all = q.all === "1";
  if (all) requireRole(ctx, "admin");
  const rows = await ctx.tx<Row[]>`${KSEL(ctx)} where ${all ? ctx.tx`true` : ctx.tx`user_id = ${ctx.userId}`} ${c ? ctx.tx`and id > ${c}::uuid` : ctx.tx``} order by id limit ${q.limit + 1}`;
  return listPage(ctx, "api_keys", q, rows);
});
export const createApiKey = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireSession(ctx);
  const b = await parseJson(req, keyBody), id = uuidv7(), k = newApiKey();
  const live = await ctx.tx`select count(*)::int n from api_keys where user_id = ${ctx.userId} and revoked_at is null`;
  if ((live[0]!.n as number) >= 25) throw new ApiError("conflict", "too many active API keys (max 25)");
  const exp = b.expires_in_days ? new Date(Date.now() + b.expires_in_days * 86400_000) : null;
  await ctx.tx`insert into api_keys (id, workspace_id, user_id, name, prefix, key_hash, scope, expires_at)
    values (${id}, ${ctx.workspaceId}, ${ctx.userId}, ${b.name}, ${k.prefix}, ${k.hash}, ${b.scope}, ${exp})`;
  const rows = await ctx.tx<Row[]>`${KSEL(ctx)} where id = ${id}`;
  await audit(ctx, "api_key", id, "create", diffOf(null, rows[0]!, ["name", "prefix", "scope", "expires_at"]));
  return json({ ...rows[0]!, token: k.token }, 201); // the only time the plain token is ever returned
});
export const revokeApiKey = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireSession(ctx);
  const id = parseId(rawId);
  const u = await ctx.tx`update api_keys set revoked_at = now() where id = ${id} and revoked_at is null
    and ${atLeast(ctx.role, "admin") ? ctx.tx`true` : ctx.tx`user_id = ${ctx.userId}`} returning id`;
  if (!u.length) throw new ApiError("not_found");
  await audit(ctx, "api_key", id, "revoke", {});
  return new Response(null, { status: 204 });
});

// ------------------------------------------------ outbound webhooks (workspace admin, session-only)
const WSEL = (ctx: Ctx) => ctx.tx`select id, url, events, active, created_by, created_at, updated_at from webhooks`;
const url = z.string().max(2000).superRefine((v, c) => { const e = webhookUrlError(v); if (e) c.addIssue({ code: "custom", message: e }); });
const events = z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length).transform((a) => [...new Set(a)]);
const hookBody = z.object({ url, events, active: z.boolean().default(true) }).strict();
const hookPatch = z.object({ url, events, active: z.boolean() }).partial().strict();
const admin = (ctx: Ctx) => { requireSession(ctx); requireRole(ctx, "admin"); };
const getHook = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${WSEL(ctx)} where id = ${id}`;
  if (!r[0]) throw new ApiError("not_found");
  return r[0];
};

export const listWebhooks = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  admin(ctx);
  const q = parseQuery(req, listQuery), c = afterId(ctx, "webhooks", q);
  const rows = await ctx.tx<Row[]>`${WSEL(ctx)} where ${c ? ctx.tx`id > ${c}::uuid` : ctx.tx`true`} order by id limit ${q.limit + 1}`;
  return listPage(ctx, "webhooks", q, rows);
});
export const createWebhook = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  admin(ctx);
  const b = await parseJson(req, hookBody), id = uuidv7(), secret = newWebhookSecret();
  const n = await ctx.tx`select count(*)::int n from webhooks`;
  if ((n[0]!.n as number) >= 20) throw new ApiError("conflict", "too many webhooks (max 20)");
  await ctx.tx`insert into webhooks (id, workspace_id, url, secret, events, active, created_by)
    values (${id}, ${ctx.workspaceId}, ${b.url}, ${secret}, ${b.events}, ${b.active}, ${ctx.userId})`;
  const row = await getHook(ctx, id);
  await audit(ctx, "webhook", id, "create", diffOf(null, row, ["url", "events", "active"]));
  return json({ ...row, secret }, 201); // shown once; used to verify X-MiniLinear-Signature
});
export const getWebhookH = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => { admin(ctx); return json(await getHook(ctx, parseId(rawId))); });
export const patchWebhook = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  admin(ctx);
  const id = parseId(rawId), b = await parseJson(req, hookPatch), before = await getHook(ctx, id);
  await ctx.tx`update webhooks set url = ${b.url ?? (before.url as string)}, events = ${b.events ?? (before.events as string[])},
    active = ${b.active ?? (before.active as boolean)}, updated_at = now() where id = ${id}`;
  const after = await getHook(ctx, id);
  await audit(ctx, "webhook", id, "update", diffOf(before, after, ["url", "events", "active"]));
  return json(after);
});
export const deleteWebhook = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  admin(ctx);
  const id = parseId(rawId);
  const d = await ctx.tx`delete from webhooks where id = ${id} returning id`;
  if (!d.length) throw new ApiError("not_found");
  await audit(ctx, "webhook", id, "delete", {});
  return new Response(null, { status: 204 });
});
const DSEL = (ctx: Ctx) => ctx.tx`select id, event, status, attempts, next_attempt_at, last_status_code, last_error, created_at, delivered_at, payload from webhook_deliveries`;
/** Delivery log, newest first (ids are random here, so keyset on (created_at, id) is encoded as "<iso>|<id>"). */
export const listDeliveries = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  admin(ctx);
  const id = parseId(rawId); await getHook(ctx, id);
  const q = parseQuery(req, listQuery.extend({ status: z.enum(["pending", "succeeded", "failed"]).optional() }));
  const c = afterId(ctx, `deliveries:${id}`, q);
  const [ts, cid] = c ? c.split("|") : [];
  const rows = await ctx.tx<Row[]>`${DSEL(ctx)} where webhook_id = ${id} ${q.status ? ctx.tx`and status = ${q.status}` : ctx.tx``}
    ${c ? ctx.tx`and (created_at, id) < (${ts!}::timestamptz, ${cid!}::uuid)` : ctx.tx``} order by created_at desc, id desc limit ${q.limit + 1}`;
  const items = rows.slice(0, q.limit), more = rows.length > q.limit, last = items[items.length - 1];
  const pos = last ? `${(last.created_at as Date).toISOString()}|${last.id as string}` : "";
  return json({ items, next_cursor: more ? encodeCursor(ctx.workspaceId, `deliveries:${id}`, { k: pos, id: pos }) : null });
});
/** Re-queue a past delivery (same event + payload) as a fresh one. */
export const redeliver = (req: Request, slug: string, rawId: string, rawDid: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  admin(ctx);
  const id = parseId(rawId), did = parseId(rawDid);
  const r = await ctx.tx<Row[]>`insert into webhook_deliveries (workspace_id, webhook_id, event, payload)
    select workspace_id, webhook_id, event, payload from webhook_deliveries where id = ${did} and webhook_id = ${id}
    returning id, event, status, attempts, next_attempt_at, created_at`;
  if (!r[0]) throw new ApiError("not_found");
  return json(r[0], 202);
});

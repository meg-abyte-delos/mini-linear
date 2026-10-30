// Cron producer of `due_soon` notifications. Not a public API: lives under /api/internal and is gated by CRON_SECRET.
// No elevated write path: the cross-workspace candidate list is a read-only SQL function; every notification is then written
// as the recipient, in its workspace, under the same RLS as the API (app.workspace_id + app.user_id set per candidate).
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { db } from '../http/ctx';
import { ApiError, errorResponse } from '../http/errors';
import { uuidv7 } from '../uuid7';

const digest = (v: string) => createHash('sha256').update(v).digest();

type Cand = { workspace_id: string; issue_id: string; assignee_id: string; due_date: string };

export async function dueSoon(req: Request): Promise<Response> {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) return Response.json({ error: { code: 'service_unavailable', message: 'cron secret not configured', request_id: randomUUID() } }, { status: 503 }); // fail closed
    const given = req.headers.get('x-cron-secret') ?? '';
    if (!given || !timingSafeEqual(digest(given), digest(secret))) throw new ApiError('unauthenticated');
    const sql = db();
    const cands = await sql<Cand[]>`select workspace_id, issue_id, assignee_id, due_date::text as due_date from cron_due_soon_candidates()`;
    let created = 0;
    for (const c of cands) {
      const ok = await sql.begin(async (tx) => {
        await tx`select set_config('app.workspace_id', ${c.workspace_id}, true)`;
        await tx`select set_config('app.user_id', ${c.assignee_id}, true)`;
        const [m] = await tx<{ role: string }[]>`select role from memberships where workspace_id = ${c.workspace_id} and user_id = ${c.assignee_id}`;
        if (!m) return false;
        const [i] = await tx<{ team_id: string }[]>`select team_id from issues where id = ${c.issue_id} and deleted_at is null`;
        if (!i) return false;
        const seen = m.role === 'owner' || m.role === 'admin' ? true
          : m.role === 'guest' ? (await tx`select 1 from issue_shares where issue_id = ${c.issue_id} and guest_user_id = ${c.assignee_id} and revoked_at is null`).length > 0
          : (await tx`select 1 from team_memberships where team_id = ${i.team_id} and user_id = ${c.assignee_id}`).length > 0;
        if (!seen) return false;
        const off = await tx`select 1 from notification_preferences where user_id = ${c.assignee_id} and type = 'due_soon' and not in_app`;
        if (off.length) return false;
        const dup = await tx`select 1 from notifications where user_id = ${c.assignee_id} and issue_id = ${c.issue_id} and type = 'due_soon' and meta ->> 'due_date' = ${c.due_date}`;
        if (dup.length) return false;
        const id = uuidv7();
        await tx`insert into notifications (id, workspace_id, user_id, actor_id, type, issue_id, meta)
          values (${id}, ${c.workspace_id}, ${c.assignee_id}, null, 'due_soon', ${c.issue_id}, ${tx.json({ due_date: c.due_date })})`;
        await tx`select sync_publish('notification', ${id}::uuid, ${c.issue_id}::uuid, 'create', 1, ${c.assignee_id}::uuid, null)`;
        return true;
      });
      if (ok) created++;
    }
    return Response.json({ candidates: cands.length, created });
  } catch (e) {
    return errorResponse(e);
  }
}

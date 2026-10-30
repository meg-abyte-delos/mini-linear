// Emit helper for the change feed (sync_events). Every lane emits through here (or through the SQL function sync_publish it wraps):
// the event is written in the caller's transaction, so a rolled-back write emits nothing. Payloads are ids + version only.
import type { Ctx } from '../http/ctx';

export type SyncEntity = 'issue' | 'comment' | 'relation' | 'attachment' | 'label' | 'project' | 'cycle' | 'view' | 'notification' | 'view_state' | 'favorite';
export type SyncOp = 'create' | 'update' | 'delete';
export type SyncEmit = {
  entity: SyncEntity; id: string; op: SyncOp;
  /** Row version after the write (0 when the entity is not versioned). */
  version?: number;
  /** Issue the event belongs to: visibility is decided on it. Omit for workspace-wide entities (project, cycle, label, view). */
  issueId?: string | null;
  /** Per-user event (view_state, favorite, notification): delivered to this user only. */
  userId?: string | null;
  /** Short discriminator for per-user events, e.g. a view id or `favorite:project`. */
  scope?: string | null;
};

export async function emitSync(ctx: Ctx, e: SyncEmit): Promise<void> {
  await ctx.tx`select sync_publish(${e.entity}, ${e.id}::uuid, ${e.issueId ?? null}::uuid, ${e.op}, ${e.version ?? 0}::int, ${e.userId ?? null}::uuid, ${e.scope ?? null})`;
}
/** Several ids of one entity (bulk writes). */
export async function emitSyncMany(ctx: Ctx, e: Omit<SyncEmit, 'id'>, ids: string[]): Promise<void> {
  for (const id of ids) await emitSync(ctx, { ...e, id });
}

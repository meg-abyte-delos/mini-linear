import type postgres from "postgres";
import { uuidv7 } from "./uuid7";

const SECRET_KEYS = /password|hash|token|secret|cookie/i;
export type Diff = Record<string, { before: unknown; after: unknown }>;

/** Field-level diff of two plain objects, restricted to `fields`; secret-looking fields are dropped. */
export function diffOf(before: Record<string, unknown> | null, after: Record<string, unknown> | null, fields: string[]): Diff {
  const d: Diff = {};
  for (const f of fields) {
    if (SECRET_KEYS.test(f)) continue;
    const b = before?.[f] ?? null, a = after?.[f] ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) d[f] = { before: b, after: a };
  }
  return d;
}

/** Append an audit event in the caller's transaction (commits or rolls back with the change). Secrets are redacted. */
export async function recordAudit(tx: postgres.TransactionSql, e: { workspaceId: string; actorId: string | null; entity: string; entityId: string | null; action: string; diff?: Diff }) {
  const diff: Diff = {};
  for (const [k, v] of Object.entries(e.diff ?? {})) if (!SECRET_KEYS.test(k)) diff[k] = v;
  await tx`insert into audit_events (id, workspace_id, actor_id, entity, entity_id, action, diff)
    values (${uuidv7()}, ${e.workspaceId}, ${e.actorId}, ${e.entity}, ${e.entityId}, ${e.action}, ${tx.json(diff as never)})`;
}

/** Deep copy with every secret-looking key (password, hash, token, secret, cookie) replaced by "[redacted]" (S11). */
export function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : redact(x)]));
  return v;
}

// Seed helper for integration tests. Fixtures are inserted as OWNER (DATABASE_OWNER_URL); assertions run as app_user (DATABASE_URL).
import postgres from "postgres";
import { randomUUID } from "node:crypto";

export const ownerSql = () => postgres(process.env.DATABASE_OWNER_URL ?? "");
export const appSql = () => postgres(process.env.DATABASE_URL ?? "");

type Role = "owner" | "admin" | "member" | "guest";
export type SeededWorkspace = { id: string; slug: string } & Record<Role, string>;
export type Seed = { a: SeededWorkspace; b: SeededWorkspace };

async function seedWorkspace(sql: postgres.Sql, slug: string): Promise<SeededWorkspace> {
  const ws = randomUUID();
  await sql`insert into workspaces (id, slug, name) values (${ws}, ${slug}, ${slug})`;
  const ids = {} as Record<Role, string>;
  for (const role of ["owner", "admin", "member", "guest"] as const) {
    const uid = randomUUID();
    ids[role] = uid;
    await sql`insert into users (id, email, password_hash, email_verified_at) values (${uid}, ${`${role}@${slug}.test`}, 'x', now())`;
    await sql`insert into memberships (id, workspace_id, user_id, role) values (${randomUUID()}, ${ws}, ${uid}, ${role})`;
  }
  return { id: ws, slug, ...ids };
}

/** Two isolated workspaces with one user per role each (unique slugs per call). */
export async function seedTwoWorkspaces(sql: postgres.Sql = ownerSql()): Promise<Seed> {
  const s = randomUUID().slice(0, 8);
  return { a: await seedWorkspace(sql, `ws-a-${s}`), b: await seedWorkspace(sql, `ws-b-${s}`) };
}

/** Run fn in one tx with app.workspace_id set (null = left unset). Use with the app_user connection. */
export async function withWorkspace<T>(sql: postgres.Sql, workspaceId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    if (workspaceId) await tx`select set_config('app.workspace_id', ${workspaceId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

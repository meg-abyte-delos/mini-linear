// The e2e database is persistent and the inbox specs mutate it (read, archive, snooze): put the 3 seeded notifications
// back to their baseline (DEM-1 and DEM-2 unread, DEM-3 read) before each inbox spec. Needs DATABASE_OWNER_URL (CI job env / local env).
import pg from 'pg';
import { id, USERS } from '../../scripts/demo-ids';

export async function resetInbox(): Promise<void> {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required to reset the demo inbox');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.workspace_id', $1, true), set_config('app.user_id', (select id::text from users where lower(email) = $2), true)", [id(1), USERS.inbox.email]);
    await c.query('update notifications set read_at = case when id = $3 then now() else null end, archived_at = null, snoozed_until = null where id = any($1::uuid[]) and workspace_id = $2', [[id(310), id(311), id(312)], id(1), id(310)]);
    await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; } finally { await c.end(); }
}

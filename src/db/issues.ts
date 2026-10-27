import type postgres from "postgres";

/**
 * Allocate the next issue number of a team (identifier = TEAMKEY-n). Must run inside the request transaction with
 * app.workspace_id set: the UPDATE takes the team row lock, so concurrent creators serialize; a rolled-back
 * transaction releases its number (no gaps among committed issues, numbers never reused).
 */
export async function allocateIssueNumber(tx: postgres.TransactionSql, teamId: string): Promise<number> {
  const rows = await tx<{ issue_seq: number }[]>`update teams set issue_seq = issue_seq + 1 where id = ${teamId} returning issue_seq`;
  if (rows.length === 0) throw new Error("NOT_FOUND: team"); // other tenant's team is invisible under RLS
  return rows[0]!.issue_seq;
}

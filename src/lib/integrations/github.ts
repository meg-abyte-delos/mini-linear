// GitHub integration (Area 9 / Part 4): pure parsing + signature helpers and the inbound webhook handler.
import { createHmac, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";
import { db } from "../http/ctx";
import { recordAudit } from "../audit";
import { uuidv7 } from "../uuid7";

export const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024;
export type IssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type LinkVia = "branch" | "magic_word" | "mention";
export type IssueRef = { key: string; number: number; via: LinkVia; closes: boolean };

/** X-Hub-Signature-256 = "sha256=" + hex HMAC-SHA256(secret, raw body). Constant-time; any malformed header is false. */
export function verifySignature(secret: string, rawBody: Uint8Array | string, header: string | null): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
export const sign = (secret: string, body: string | Uint8Array) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

const KEY_RE = "([A-Za-z]{2,5})-(\\d{1,9})";
const MAGIC = "(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|complete[sd]?)";
const num = (s: string) => Number.parseInt(s, 10);

/**
 * Issue references in a PR, Linear-style:
 * - branch containing a key (eng-123-foo, user/ENG-123) -> closing link;
 * - magic word + key(s) in title/body ("Fixes ENG-1, ENG-2", "closes: ENG-3") -> closing link;
 * - any other key in the title/body -> plain link (never moves the issue).
 * Keys are matched case-insensitively and normalised to upper case. Strongest reason wins per issue; order is stable.
 */
export function extractIssueRefs(input: { branch?: string | null; title?: string | null; body?: string | null }): IssueRef[] {
  const out = new Map<string, IssueRef>();
  const rank: Record<LinkVia, number> = { branch: 3, magic_word: 2, mention: 1 };
  const add = (k: string, n: string, via: LinkVia) => {
    const r: IssueRef = { key: k.toUpperCase(), number: num(n), via, closes: via !== "mention" };
    if (r.number <= 0) return;
    const id = `${r.key}-${r.number}`, prev = out.get(id);
    if (!prev || rank[via] > rank[prev.via]) out.set(id, r);
  };
  const branch = input.branch ?? "";
  for (const m of branch.matchAll(new RegExp(`(?:^|[^A-Za-z0-9])${KEY_RE}(?![0-9])`, "g"))) add(m[1]!, m[2]!, "branch");
  const text = `${input.title ?? ""}\n${input.body ?? ""}`.slice(0, 200_000);
  const magic = new RegExp(`\\b${MAGIC}\\b:?\\s+((?:${KEY_RE}(?:\\s*(?:,|and|&)\\s*)?)+)`, "gi");
  for (const m of text.matchAll(magic)) for (const k of m[1]!.matchAll(new RegExp(KEY_RE, "g"))) add(k[1]!, k[2]!, "magic_word");
  for (const m of text.matchAll(new RegExp(`\\b${KEY_RE}\\b`, "g"))) add(m[1]!, m[2]!, "mention");
  return [...out.values()];
}

const ORDER: IssueStatus[] = ["backlog", "todo", "in_progress", "in_review", "done"];
/** Automation only moves an issue forward and never touches a canceled one (no reopen of done/canceled work). */
export function nextStatus(current: IssueStatus, target: IssueStatus | null): IssueStatus | null {
  if (!target || current === "canceled" || target === current) return null;
  if (target === "canceled") return null;
  return ORDER.indexOf(target) > ORDER.indexOf(current) ? target : null;
}

export type PrState = "draft" | "open" | "closed" | "merged";
export type Trigger = "open" | "review" | "merge" | null;
/** Map a pull_request action to the stored PR state and which team automation to apply. */
export function classify(action: string, pr: { draft?: boolean; merged?: boolean; state?: string }): { state: PrState; trigger: Trigger } | null {
  const live: PrState = pr.state === "closed" ? (pr.merged ? "merged" : "closed") : pr.draft ? "draft" : "open";
  switch (action) {
    case "opened": case "reopened": case "ready_for_review": return { state: live, trigger: live === "open" ? "open" : null };
    case "review_requested": return { state: live, trigger: live === "open" ? "review" : null };
    case "edited": case "synchronize": case "converted_to_draft": return { state: live, trigger: null };
    case "closed": return { state: pr.merged ? "merged" : "closed", trigger: pr.merged ? "merge" : null };
    default: return null;
  }
}

const DEFAULTS = { on_pr_open: "in_progress", on_pr_review: "in_review", on_pr_merge: "done" } as const;
const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

type Pr = { number: number; html_url: string; title?: string; body?: string | null; draft?: boolean; merged?: boolean; state?: string; head?: { ref?: string } };
type Payload = { action?: string; pull_request?: Pr; repository?: { full_name?: string } };

/**
 * POST /api/v1/integrations/github/webhook/:connectionId. No session: authenticity = HMAC over the raw body with the
 * workspace's secret. Unknown connection and bad signature both answer 401 (no oracle). Idempotent per delivery id.
 */
export async function handleGithubWebhook(req: Request, connectionId: string, sql: postgres.Sql = db()): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return json(401, { error: { code: "unauthenticated", message: "invalid signature" } });
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_WEBHOOK_BYTES) return json(413, { error: { code: "bad_request", message: "payload too large" } });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > MAX_WEBHOOK_BYTES) return json(413, { error: { code: "bad_request", message: "payload too large" } });
  const event = req.headers.get("x-github-event") ?? "";
  const delivery = (req.headers.get("x-github-delivery") ?? "").slice(0, 100);
  try {
    return (await sql.begin(async (tx) => {
      const t = await tx<{ workspace_id: string; webhook_secret: string }[]>`select workspace_id, webhook_secret from github_webhook_target(${connectionId}::uuid)`;
      if (!t[0] || !verifySignature(t[0].webhook_secret, raw, req.headers.get("x-hub-signature-256")))
        return json(401, { error: { code: "unauthenticated", message: "invalid signature" } });
      const ws = t[0].workspace_id;
      await tx`select set_config('app.workspace_id', ${ws}, true)`;
      if (event === "ping") return json(200, { ok: true, event });
      if (!delivery) return json(400, { error: { code: "bad_request", message: "missing X-GitHub-Delivery" } });
      const fresh = await tx`insert into github_webhook_deliveries (workspace_id, delivery_id, event) values (${ws}, ${delivery}, ${event.slice(0, 64)})
        on conflict do nothing returning delivery_id`;
      if (fresh.length === 0) return json(200, { ok: true, duplicate: true });
      if (event !== "pull_request") return json(202, { ok: true, ignored: event });
      let p: Payload;
      try { p = JSON.parse(new TextDecoder().decode(raw)) as Payload; } catch { return json(400, { error: { code: "bad_request", message: "body must be JSON" } }); }
      const pr = p.pull_request, repo = p.repository?.full_name;
      const c = pr && p.action ? classify(p.action, pr) : null;
      if (!pr || !repo || !c || !Number.isInteger(pr.number) || typeof pr.html_url !== "string") return json(202, { ok: true, ignored: p.action ?? null });
      return json(200, { ok: true, ...(await applyPullRequest(tx, ws, repo, pr, c)) });
    })) as Response;
  } catch (e) {
    console.error("github webhook failed", (e as Error)?.message);
    return json(500, { error: { code: "internal", message: "internal error" } });
  }
}

async function applyPullRequest(tx: postgres.TransactionSql, ws: string, repo: string, pr: Pr, c: { state: PrState; trigger: Trigger }) {
  const refs = extractIssueRefs({ branch: pr.head?.ref, title: pr.title, body: pr.body });
  const linked: string[] = [], moved: { issue: string; from: string; to: string }[] = [];
  const keep: string[] = [];
  for (const r of refs.slice(0, 50)) {
    const rows = await tx<{ id: string; status: IssueStatus; team_id: string; on_pr_open: IssueStatus | null; on_pr_review: IssueStatus | null; on_pr_merge: IssueStatus | null; has_settings: boolean }[]>`
      select i.id, i.status, i.team_id, s.on_pr_open, s.on_pr_review, s.on_pr_merge, (s.team_id is not null) has_settings
      from issues i join teams t on t.id = i.team_id left join github_team_settings s on s.team_id = i.team_id
      where t.key = ${r.key} and i.number = ${r.number} and i.deleted_at is null`;
    const i = rows[0];
    if (!i) continue;
    keep.push(i.id);
    await tx`insert into issue_pr_links (id, workspace_id, issue_id, repo_full_name, pr_number, url, title, head_branch, state, linked_via, closes)
      values (${uuidv7()}, ${ws}, ${i.id}, ${repo}, ${pr.number}, ${pr.html_url.slice(0, 2048)}, ${(pr.title ?? "").slice(0, 1024)}, ${(pr.head?.ref ?? "").slice(0, 512)}, ${c.state}, ${r.via}, ${r.closes})
      on conflict (issue_id, repo_full_name, pr_number) do update set url = excluded.url, title = excluded.title, head_branch = excluded.head_branch,
        state = excluded.state, linked_via = excluded.linked_via, closes = excluded.closes, updated_at = now()`;
    linked.push(`${r.key}-${r.number}`);
    if (!r.closes || !c.trigger) continue;
    const cfg = i.has_settings ? i : DEFAULTS;
    const target = c.trigger === "open" ? cfg.on_pr_open : c.trigger === "review" ? cfg.on_pr_review : cfg.on_pr_merge;
    const to = nextStatus(i.status, target as IssueStatus | null);
    if (!to) continue;
    await tx`update issues set status = ${to}, version = version + 1, updated_at = now() where id = ${i.id}`;
    await recordAudit(tx, { workspaceId: ws, actorId: null, entity: "issue", entityId: i.id, action: "github_automation",
      diff: { status: { before: i.status, after: to } } });
    moved.push({ issue: `${r.key}-${r.number}`, from: i.status, to });
  }
  // Links that came from text the author since removed are dropped; branch links stay as long as the branch matches.
  await tx`update issue_pr_links set state = ${c.state}, updated_at = now() where repo_full_name = ${repo} and pr_number = ${pr.number}`;
  await tx`delete from issue_pr_links where repo_full_name = ${repo} and pr_number = ${pr.number}
    and ${keep.length ? tx`issue_id <> all(${keep}::uuid[])` : tx`true`}`;
  return { linked, moved };
}

// Data for scripts/seed-demo-rich.mts: DEM-11..DEM-60, personas, labels, comments. Fixed dates only (no Date.now) so the seed is deterministic.
export type Who = 'admin' | 'mate' | 'maya' | 'jonas' | 'priya' | 'leo';
export const STATE_KEYS = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];
export const RICH_USERS: { key: Who; email: string; name: string }[] = [
  { key: 'maya', email: 'maya@example.test', name: 'Maya Chen' },
  { key: 'jonas', email: 'jonas@example.test', name: 'Jonas Weber' },
  { key: 'priya', email: 'priya@example.test', name: 'Priya Nair' },
  { key: 'leo', email: 'leo@example.test', name: 'Leo Marchand' },
];
export type LabelKey = 'infra' | 'bug' | 'feature' | 'improvement' | 'design' | 'performance' | 'docs' | 'security' | 'a11y' | 'techdebt' | 'triage';
export const LABEL_GROUPS: [string, string, string][] = [['type', 'Type', '#5e6ad2'], ['area', 'Area', '#26b5ce']];
// key, name, colour, group. infra/bug/feature are the base seed labels (ids 60-62): the rich seed recolours and groups them.
export const ALL_LABELS: [LabelKey, string, string, string | null][] = [
  ['bug', 'Bug', '#eb5757', 'type'], ['feature', 'Feature', '#26b5ce', 'type'], ['improvement', 'Improvement', '#4cb782', 'type'], ['techdebt', 'Tech debt', '#8a6d3b', 'type'],
  ['infra', 'Infra', '#5e6ad2', 'area'], ['performance', 'Performance', '#f2994a', 'area'], ['security', 'Security', '#d6409f', 'area'], ['design', 'Design', '#bb87fc', 'area'],
  ['docs', 'Docs', '#95a2b3', null], ['a11y', 'Accessibility', '#f5c542', null], ['triage', 'Needs triage', '#e07a5f', null],
];
export const RICH_LABELS: [string, string, string][] = ALL_LABELS.filter(([k]) => !['infra', 'bug', 'feature'].includes(k)).map(([k, n, c]) => [k, n, c]);
// Display names for the base-seed personas (the rich seed runs after seed-demo, which names them "Demo Admin" / "Ada Kernel"). Keyed by email.
export const PERSONA_NAMES: Record<string, string> = { 'demo@example.test': 'Elena Vasquez', 'mate@example.test': 'Sam Okafor', 'guest@example.test': 'Hana Kobayashi', 'inbox@example.test': 'Tom Becker' };
/** Day 0 = 2026-09-14. */
export const atDay = (day: number, hour = 0, minute = 0) => new Date(Date.UTC(2026, 8, 14 + day, 8 + hour, minute)).toISOString();
type L = LabelKey;
export type TeamKey = 'DEM' | 'PLT' | 'DSN';
export type RichIssue = { team: TeamKey; key: number; n: number; title: string; desc: string; state: number; prio: number; who: Who | null; by: Who; pj: 'p1' | 'p2' | 'p3' | null; cy: 'c1' | 'c2' | 'c3' | null; labels: L[]; day: number; age: number; est?: number; due?: string };
// n, title, state (0 backlog .. 4 done, 5 canceled), priority (0 none, 1 urgent .. 4 low), assignee, project, cycle, labels, created day, days to reach current state, estimate, due date, description
type T = [number, string, number, number, Who | null, 'p1' | 'p2' | 'p3' | null, 'c1' | 'c2' | 'c3' | null, L[], number, number, number | undefined, string | undefined, string];
const ROWS: T[] = [
  [11, 'Add keyboard navigation to the issue list', 4, 3, 'maya', 'p1', 'c1', ['feature'], 16, 4, 3, undefined, 'Move the selection with j and k, open with Enter, and keep the focus ring visible.'],
  [12, 'Persist list grouping and ordering per view', 4, 3, 'jonas', 'p1', 'c1', ['improvement'], 17, 5, 3, undefined, 'Grouping and ordering reset on every reload. Store them with the saved view.'],
  [13, 'Fix board card flicker while dragging between columns', 4, 2, 'mate', 'p1', 'c1', ['bug'], 18, 3, 2, undefined, 'The card disappears for one frame when it crosses a column boundary.'],
  [14, 'Rate limit the login endpoint', 4, 1, 'priya', 'p1', 'c1', ['security'], 18, 6, 3, undefined, 'Throttle by IP and by email, return 429 with Retry-After.'],
  [15, 'Write the contributing guide', 4, 4, 'leo', 'p1', 'c1', ['docs'], 19, 8, 2, undefined, 'Branch naming, how to run the tests, how reviews work.'],
  [16, 'Index issues by workspace and team for list queries', 4, 2, 'jonas', 'p1', 'c1', ['performance'], 20, 4, 5, undefined, 'The list query scans the whole issues table for large workspaces.'],
  [17, 'Define colour tokens for the dark theme', 4, 2, 'maya', 'p3', 'c1', ['design'], 21, 7, 3, undefined, 'Surface, border, text and accent tokens with AA contrast on every surface.'],
  [18, 'Button, input and select primitives', 4, 2, 'maya', 'p3', 'c1', ['design', 'feature'], 22, 9, 5, undefined, 'Shared components with hover, focus, disabled and loading states.'],
  [19, 'Cron expression parser: field ranges', 4, 2, 'mate', 'p2', 'c1', ['feature'], 22, 6, 5, undefined, 'Validate each field against its range and report the position of the error.'],
  [20, 'Cron: support step and list syntax', 4, 2, 'mate', 'p2', 'c1', ['feature'], 24, 5, 3, undefined, 'Handle */5, 1-10/2 and 1,15,30 in every field.'],
  [21, 'Drop the legacy CSV export', 5, 4, 'admin', 'p1', 'c1', [], 24, 2, undefined, undefined, 'Replaced by the API export. Not worth maintaining.'],
  [22, 'Session cookie not marked Secure behind the proxy', 4, 1, 'priya', 'p1', 'c2', ['bug', 'security'], 27, 2, 2, undefined, 'The Secure flag depends on the request scheme, which the proxy hides. Trust the forwarded header from known proxies.'],
  [23, 'Issue page: inline title editing', 4, 2, 'leo', 'p1', 'c2', ['feature'], 28, 6, 3, undefined, 'Click the title to edit, Enter saves, Escape cancels.'],
  [24, 'Show relative timestamps in the activity feed', 4, 3, 'leo', 'p1', 'c2', ['improvement'], 29, 5, 2, undefined, '5m ago, yesterday, Oct 12. Full date on hover.'],
  [25, 'Inbox: snooze until tomorrow', 4, 3, 'priya', 'p1', 'c2', ['feature'], 30, 6, 3, undefined, 'Snoozed notifications come back at 9:00 the next day.'],
  [26, 'Reduce the bundle size of the board route', 4, 3, 'jonas', 'p1', 'c2', ['performance'], 30, 8, 5, undefined, 'Lazy-load the drag and drop library and the chart code.'],
  [27, 'Command palette: recent issues', 4, 3, 'maya', 'p1', 'c2', ['feature'], 31, 7, 3, undefined, 'Show the last five visited issues when the palette opens empty.'],
  [28, 'Empty states for projects and cycles', 4, 3, 'maya', 'p3', 'c2', ['design'], 32, 5, 2, undefined, 'One line of copy and one primary action per empty screen.'],
  [29, 'Motion guidelines: durations and easing', 4, 4, 'maya', 'p3', 'c2', ['design', 'docs'], 33, 6, 2, undefined, 'Fast 120ms, base 200ms, slow 320ms. Respect prefers-reduced-motion.'],
  [30, 'Human-readable descriptions for schedule expressions', 4, 3, 'mate', 'p2', 'c2', ['feature'], 33, 8, 5, undefined, 'Turn 0 9 * * 1-5 into Every weekday at 09:00.'],
  [31, 'Next-run preview for a cron expression', 4, 3, 'mate', 'p2', 'c2', ['feature'], 34, 7, 3, undefined, 'List the next five fire times for a given start date.'],
  [32, 'Duplicate issue created when double-clicking Create', 4, 2, 'jonas', 'p1', 'c2', ['bug'], 35, 3, 2, undefined, 'Disable the button while the request is in flight and send an idempotency key.'],
  [33, 'Document REST API authentication', 4, 4, 'leo', 'p1', 'c2', ['docs'], 36, 5, 2, undefined, 'API keys, scopes and the error format.'],
  [34, 'Bulk edit toolbar for selected issues', 3, 2, 'priya', 'p1', 'c3', ['feature'], 38, 8, 5, '2026-11-06', 'Change status, assignee, priority and labels for the whole selection in one request.'],
  [35, 'Cycle burndown: tooltip with scope changes', 3, 3, 'jonas', 'p1', 'c3', ['improvement'], 39, 6, 3, undefined, 'Show added and removed issues for the hovered day.'],
  [36, 'Members page: invite by email', 3, 3, 'priya', 'p1', 'c3', ['feature'], 40, 5, 3, '2026-11-04', 'Admins can invite a teammate, pick a role, and revoke a pending invite.'],
  [37, 'Label picker loses focus after selecting', 4, 2, 'leo', 'p1', 'c3', ['bug'], 41, 3, 2, undefined, 'After picking a label the focus jumps to the page body, so keyboard users cannot pick a second one.'],
  [38, 'Skeleton loading states for the issue list', 2, 3, 'maya', 'p1', 'c3', ['design', 'performance'], 41, 3, 3, undefined, 'Replace the spinner with row skeletons that match the final layout.'],
  [39, 'Webhook delivery retries with backoff', 2, 2, 'jonas', 'p1', 'c3', ['infra'], 41, 4, 5, '2026-10-29', 'Retry failed deliveries up to 6 times, exponential backoff, then mark the endpoint failing.'],
  [40, 'Sidebar: collapse sections and remember the state', 4, 3, 'maya', 'p3', 'c3', ['improvement'], 42, 2, 2, undefined, 'Workspace, Team and Favorites sections fold; the choice is stored per user.'],
  [41, 'Tabs, tooltip and popover components', 2, 3, 'maya', 'p3', 'c3', ['design', 'feature'], 42, 3, 5, undefined, 'Accessible primitives with focus management and escape handling.'],
  [42, 'Audit log export for admins', 2, 3, 'admin', 'p1', 'c3', ['security'], 43, 2, 3, '2026-11-09', 'Download the audit log as CSV for a date range.'],
  [43, 'Cron: timezone-aware next run', 2, 2, 'mate', 'p2', 'c3', ['feature'], 43, 2, 5, undefined, 'Accept an IANA timezone and handle DST gaps and overlaps.'],
  [44, 'Roadmap: drag to change the target date', 1, 3, 'maya', 'p1', 'c3', ['feature'], 43, 1, 5, undefined, 'Drag the end of a project bar to move its target date.'],
  [45, 'Guest can still open an issue after the share is revoked', 1, 1, 'priya', 'p1', 'c3', ['bug', 'security'], 44, 1, 3, '2026-11-02', 'A cached page stays reachable. The read path must re-check the share.'],
  [46, 'Search is slow on workspaces with many issues', 1, 2, 'jonas', 'p1', 'c3', ['performance', 'bug'], 44, 1, 5, '2026-11-10', 'p95 is above one second past 50k issues.'],
  [47, 'Add a Playwright smoke test for sign-up', 1, 3, 'admin', 'p1', 'c3', ['infra'], 44, 1, 2, undefined, 'Sign up, create a workspace, create the first issue.'],
  [48, 'CLI with an --explain flag', 1, 4, 'mate', 'p2', null, ['feature'], 44, 1, 3, undefined, 'Print the description and the next runs for an expression.'],
  [49, 'Keyboard shortcut cheat sheet', 1, 4, null, 'p1', null, ['docs', 'feature'], 41, 0, undefined, undefined, 'Press ? to see every shortcut, grouped by area.'],
  [50, 'Dark theme contrast pass', 1, 3, 'maya', 'p3', null, ['design'], 40, 0, 3, undefined, 'Check every surface and state against the AA ratio.'],
  [51, 'Import issues from CSV', 0, 4, 'maya', 'p1', null, ['feature'], 36, 0, undefined, undefined, 'Map columns, preview, then import.'],
  [52, 'Share a saved view with the team', 0, 3, null, 'p1', null, ['feature'], 37, 0, undefined, undefined, 'Views are private today. Add a team-visible option.'],
  [53, 'Per-team default assignee', 0, 4, 'jonas', 'p1', null, ['improvement'], 38, 0, undefined, undefined, 'New issues in a team get its default assignee when none is chosen.'],
  [54, 'Project updates with a health status', 0, 3, null, 'p1', null, ['feature'], 39, 0, undefined, undefined, 'On track, at risk or off track, with a short note.'],
  [55, 'Sub-issue progress rollup', 0, 3, 'priya', 'p1', null, ['feature'], 39, 0, undefined, undefined, 'Show done over total on the parent issue and in lists.'],
  [56, 'Notification preferences per channel', 0, 4, null, 'p1', null, ['improvement'], 40, 0, undefined, undefined, 'Choose which events reach the inbox and which reach email.'],
  [57, 'Icon set audit: unify stroke widths', 0, 4, 'leo', 'p3', null, ['design'], 41, 0, undefined, undefined, 'Some icons are 1.5px and others 2px.'],
  [58, 'Publish the parser to npm', 0, 3, null, 'p2', null, ['infra'], 42, 0, undefined, undefined, 'Package, changelog and a release workflow.'],
  [59, 'Slack notifications for urgent issues', 0, 2, 'mate', null, null, ['feature'], 43, 0, undefined, undefined, 'Post to a channel when an urgent issue is created or reassigned.'],
  [60, 'Estimate field in the issue sidebar', 3, 3, 'priya', 'p1', 'c3', ['feature'], 40, 5, 2, undefined, 'Pick a point value from the sidebar. The list shows it as a column.'],
];
const CREATORS: Who[] = ['admin', 'maya', 'priya', 'jonas'];
// Labels added on top of the rows above (accessibility, tech debt, triage), by DEM issue number.
const EXTRA_LABELS: Record<number, L[]> = { 23: ['a11y'], 37: ['a11y'], 41: ['a11y'], 49: ['a11y'], 26: ['techdebt'], 47: ['techdebt'], 57: ['techdebt'], 51: ['triage'], 53: ['triage'], 54: ['triage'], 59: ['triage'] };
// Platform and Design teams (key = team-local number). Same row layout; no cycles (cycles belong to the DEM team).
const PLT: T[] = [
  [1, 'Move session storage to Redis', 2, 2, 'jonas', 'p1', null, ['infra', 'techdebt'], 38, 4, 5, undefined, 'Sessions live in Postgres today. Move them to Redis with a 30 day sliding TTL.'],
  [2, 'Nightly backups with a monthly restore drill', 4, 2, 'priya', 'p1', null, ['infra'], 30, 9, 3, undefined, 'Daily snapshot, 14 day retention, and a restore test on the first of each month.'],
  [3, 'Alert when the webhook queue backs up', 3, 2, 'jonas', 'p1', null, ['infra', 'improvement'], 36, 6, 3, undefined, 'Page the on-call when more than 500 deliveries wait for over five minutes.'],
  [4, 'Rotate signing keys without logging everyone out', 1, 1, 'priya', 'p1', null, ['security'], 42, 1, 5, '2026-11-05', 'Accept the previous key for 24 hours after a rotation.'],
  [5, 'Upgrade to Node 22 across CI and production', 0, 4, 'jonas', null, null, ['techdebt'], 35, 0, undefined, undefined, 'Check native modules first, then bump the base image.'],
  [6, 'Reduce cold start time of the API container', 2, 3, 'jonas', null, null, ['performance'], 40, 3, 3, undefined, 'Boot takes 4.2s, mostly loading unused route modules.'],
  [7, 'Dependabot pull requests pile up unreviewed', 0, 3, null, null, null, ['triage', 'techdebt'], 41, 0, undefined, undefined, 'Group minor updates weekly and auto-merge patch releases that pass CI.'],
  [8, 'Structured JSON logs with request ids', 4, 3, 'leo', 'p1', null, ['improvement', 'infra'], 28, 7, 3, undefined, 'Every log line carries the request id, workspace and user.'],
  [9, 'Schedules drift by a minute after a DST change', 2, 2, 'mate', 'p2', null, ['bug'], 41, 2, 3, undefined, 'The next run is computed from the wall clock instead of the zone offset.'],
];
const DSN: T[] = [
  [1, 'Redesign the inbox empty state', 4, 3, 'maya', 'p3', null, ['design'], 30, 4, 2, undefined, 'One illustration, one sentence, one action.'],
  [2, 'Icon sizes are inconsistent in the sidebar', 2, 3, 'maya', 'p3', null, ['design', 'a11y'], 39, 3, 2, undefined, 'Team and project icons are 14px, the rest are 16px. Align the hit areas too.'],
  [3, 'Focus ring is invisible on the dark board', 1, 2, 'leo', 'p3', null, ['a11y', 'bug'], 42, 1, 2, '2026-11-03', 'The ring has the same colour as the card border. Use the accent token with a 2px offset.'],
  [4, 'Illustrations for the onboarding flow', 0, 4, 'maya', 'p3', null, ['design'], 36, 0, undefined, undefined, 'Four spot illustrations in the product palette.'],
  [5, 'Rework the project health badges', 3, 3, 'maya', 'p1', null, ['design', 'improvement'], 38, 5, 3, undefined, 'On track, at risk and off track need a shape as well as a colour.'],
  [6, 'Document the spacing and typography scale', 4, 4, 'leo', 'p3', null, ['docs', 'design'], 26, 8, 2, undefined, 'A 4px grid, five text sizes, and when to use each.'],
  [7, 'Mobile layout for the issue page', 0, 3, null, 'p1', null, ['design', 'feature'], 40, 0, undefined, undefined, 'Properties move into a bottom sheet below 720px.'],
  [8, 'Colour blind friendly status icons', 2, 2, 'leo', 'p3', null, ['a11y', 'design'], 40, 3, 3, undefined, 'Each state gets a distinct shape: dashed, half, three quarters, check, cross.'],
];
// Longer markdown descriptions for the issues behind the admin's notifications, so the inbox preview pane has content.
const DETAILS: Record<number, string> = { // key: n for DEM, 100+n for PLT, 200+n for DSN
  101: 'Sessions live in Postgres today and every request reads them.\n\n## Goal\nMove them to Redis with a 30 day sliding TTL.\n\n## Steps\n1. Dual-write for one release\n2. Switch reads behind `SESSION_STORE=redis`\n3. Drop the table\n\nUsers must stay logged in during the cut-over.',
  103: 'Page the on-call when the webhook queue backs up.\n\n- Threshold: more than 500 deliveries waiting for over five minutes\n- Metric: `webhook_queue_oldest_age_seconds`\n- Runbook link in the alert body',
  104: 'Accept the previous signing key for 24 hours after a rotation.\n\n## Why\nRotating today logs everyone out.\n\n## Design\nSessions carry a `kid`. Verification tries the current key, then the previous one. A rotation job removes keys older than 24 hours.\n\nNeeds a security review before merge.',
  106: 'Boot takes 4.2s, mostly loading route modules nobody calls on startup.\n\nLazy-load the rarely used routes and measure again with `hyperfine`.',
  109: 'The next run is computed from the wall clock instead of the zone offset, so schedules drift by a minute after a DST change.\n\n## Repro\n```\n0 9 * * *  Europe/Paris\n```\nRun across the last Sunday of October and compare the fire times.',
  202: 'Team and project icons are 14px, the rest are 16px.\n\n- Align everything on 16px\n- Keep the hit area at 28px\n- Check the collapsed sidebar',
  203: 'The focus ring has the same colour as the card border on the dark board.\n\n## Fix\nUse the accent token with a `2px` offset: `outline: 2px solid var(--accent); outline-offset: 2px`.\n\nVerify with keyboard navigation on the board.',
  205: 'On track, at risk and off track need a shape as well as a colour.\n\n## Proposal\n- On track: check circle\n- At risk: warning triangle\n- Off track: cross circle\n\nTooltips spell the status out for screen readers.',
  208: 'Each state gets a distinct shape so colour is never the only signal.\n\n1. Backlog: dashed circle\n2. Todo: empty circle\n3. In progress: half\n4. In review: three quarters\n5. Done: check\n6. Canceled: cross',
  14: 'Throttle the login endpoint by IP and by email.\n\n## Behaviour\n- 5 attempts per minute per IP, 10 per hour per email\n- Respond with `429` and a `Retry-After` header\n- Successful logins do not reset the email counter\n\n## Notes\nCounters live in the rate limit table, keyed by `login:<ip>` and `login:<email>`.\n\nOpen to other numbers once we have real traffic.',
  22: 'The session cookie is not marked `Secure` behind the proxy.\n\nThe flag depends on the request scheme, which the proxy hides. Trust `X-Forwarded-Proto` only from the configured proxies (`TRUSTED_PROXIES`).\n\n## Test\n1. Request through a known proxy: cookie is `Secure`\n2. Spoofed header from an unknown proxy: ignored',
  34: 'Change status, assignee, priority and labels for a whole selection in one request.\n\n## API\n`POST /api/v1/w/:slug/issues/bulk` takes up to 100 ids and returns one result per issue, with the error code when it fails.\n\n## UI\n- Toolbar appears when two or more rows are selected\n- Partial failures are listed under the toolbar\n- Guests cannot reach it',
  46: 'Search p95 is above one second past 50k issues.\n\n## Findings\nProfiling shows a sort on a non-indexed expression: `lower(title)`.\n\n## Plan\n- Add an expression index on `(workspace_id, lower(title))`\n- Keep a trigram index for descriptions only if needed\n- Re-measure on the 50k seed',
  12: 'Grouping and ordering reset on every reload.\n\n## Scope\n- Store group-by and order-by with the saved view\n- Restore them when the view is opened\n- Unsaved views keep the defaults\n\n## Done when\nReloading the page shows the same grouping and ordering the user left.',
  16: 'The list query scans the whole issues table for large workspaces.\n\n## Plan\n1. Add a composite index starting with the workspace\n2. Check the plan with EXPLAIN on the 50k seed\n3. Keep write overhead under 5%\n\nTarget: list p95 under 50ms.',
  18: 'Shared components with hover, focus, disabled and loading states.\n\n- **Button**: primary, secondary, ghost, danger\n- **Input**: with label, hint and error\n- **Select**: keyboard friendly, mobile sheet variant\n\nEvery state must pass the AA contrast check.',
  32: 'Double-clicking Create makes two issues with the same title.\n\n**Fix**\n- Disable the button while the request is in flight\n- Send a client-generated idempotency key, kept for 24 hours\n\nSteps to reproduce: open the composer, type a title, double-click Create.',
  36: 'Admins can invite a teammate to the workspace.\n\n## Requirements\n- Pick a role when inviting\n- Invite links are single use and expire after 7 days\n- Admins can revoke a pending invite\n\nEmail delivery is a follow-up: for now only the link is shown.',
  39: 'Retry failed webhook deliveries so a short outage does not lose events.\n\n- Up to 6 attempts: 30s, 2m, 10m, 1h, 6h, 24h\n- Mark the endpoint as failing after the last attempt\n- Show a banner on the endpoint page\n\nThis is overdue for the current cycle.',
  40: 'Workspace, Team and Favorites sections can be folded.\n\nThe choice is stored per user and restored on the next visit. Keyboard: Enter or Space toggles a section.',
  42: 'Admins need the audit log outside the app.\n\n## Requirements\n- Download as CSV for a date range\n- Include issue changes and comment events\n- Admins only, rate limited\n\nOpen question: very large ranges should stream instead of loading in memory.',
  44: 'Drag the end of a project bar on the roadmap to move its target date.\n\n- Handles snap to the week; hold Alt for day precision\n- Show the new date in a tooltip while dragging\n- Escape cancels the drag',
  45: 'A cached page stays reachable after the share is revoked.\n\n## Expected\nRevoked shares return 404 on the read path immediately, for both read paths:\n1. The issue page\n2. The public link route\n\n## Notes\nThe read path must re-check the share on every request.',
  47: 'Smoke test for the first-run experience.\n\n1. Sign up\n2. Create a workspace\n3. Create the first issue\n\nRuns on the demo workspace so screenshots and tests share the same data.',
  60: 'Pick a point value from the issue sidebar.\n\nScale: 1, 2, 3, 5, 8. The list shows the estimate as a column and the cycle view sums it.\n\n- Empty means not estimated\n- Keyboard: type the number in the picker',
};
const mk = (team: TeamKey, rows: T[], keyBase: number, extra: Record<number, L[]> = {}): RichIssue[] =>
  rows.map(([n, title, state, prio, who, pj, cy, labels, day, age, est, due, desc]) => ({ team, key: keyBase + n, n, title, desc: DETAILS[keyBase + n] ?? desc, state, prio, who, by: CREATORS[n % 4]!, pj, cy, labels: [...labels, ...(extra[n] ?? [])], day, age, est, due }));
/** key = unique number across teams (DEM-n keeps n, PLT 100+n, DSN 200+n): used for ids and audit event ids. */
export const RICH_ISSUES: RichIssue[] = [...mk('DEM', ROWS, 0, EXTRA_LABELS), ...mk('PLT', PLT, 100), ...mk('DSN', DSN, 200)];
export const issueByKey = (team: TeamKey, n: number) => RICH_ISSUES.find((x) => x.team === team && x.n === n)!;

/** Comment bodies use {who} tokens for @mentions; the seed renders them as @[Display Name](uuid). `re` = index of the parent comment (replies are one level deep). */
export type RichComment = { k: number; n: number; by: Who; after: number; body: string; re?: number; resolved?: boolean };
const C = (k: number, n: number, by: Who, after: number, body: string, extra: Partial<RichComment> = {}): RichComment => ({ k, n, by, after, body, ...extra });
export const RICH_COMMENTS: RichComment[] = [
  C(0, 11, 'admin', 1, 'Please keep it consistent with the board shortcuts. {maya} can you check j and k on the board too?'),
  C(1, 11, 'maya', 3, 'Done. The focus ring uses the accent token now.', { re: 0 }),
  C(2, 14, 'priya', 2, '5 attempts per minute per IP, 10 per hour per email. Open to other numbers.', { resolved: true }),
  C(3, 14, 'admin', 3, 'Fine for now, we can tune it with real traffic.', { re: 2 }),
  C(4, 16, 'jonas', 2, 'The new index cut the list query from 420ms to 18ms on the 50k seed.'),
  C(5, 18, 'maya', 4, 'Loading state is in. Select still needs the mobile sheet variant.'),
  C(6, 19, 'mate', 2, 'Errors carry the field name and the column, same as the CLI output.'),
  C(7, 22, 'priya', 1, 'Reproduced behind nginx. Trusting X-Forwarded-Proto only from the configured proxies.', { resolved: true }),
  C(8, 22, 'jonas', 2, 'Looks right. Add a test with a spoofed header from an unknown proxy.', { re: 7 }),
  C(9, 23, 'leo', 3, 'Escape restores the previous title, and an empty title is rejected.'),
  C(10, 25, 'priya', 4, 'Snooze times are stored in UTC and shown in the user timezone.'),
  C(11, 26, 'jonas', 5, 'Board route went from 310 kB to 190 kB gzipped.'),
  C(12, 27, 'admin', 2, 'Can we also show the current project?', { resolved: true }),
  C(13, 27, 'maya', 4, 'Yes, as a second section. Tracked in a follow-up.', { re: 12 }),
  C(14, 30, 'mate', 5, 'English only for now. The strings are isolated so translation is easy later.'),
  C(15, 32, 'jonas', 1, 'The idempotency key is a client-generated UUID, kept for 24 hours.'),
  C(16, 34, 'priya', 3, 'The endpoint accepts up to 100 ids per call.', { resolved: true }),
  C(17, 34, 'admin', 5, 'Good. Make sure guests cannot reach it.', { re: 16 }),
  C(18, 35, 'jonas', 3, 'Using the scopeChange field from the burndown endpoint.'),
  C(19, 36, 'priya', 2, 'Invite emails are not sent yet, only the link is shown.'),
  C(20, 37, 'leo', 1, 'The popover unmounts on select. Keeping it mounted and moving the focus back to the input.'),
  C(21, 39, 'jonas', 2, 'Backoff is 30s, 2m, 10m, 1h, 6h, 24h.'),
  C(22, 39, 'admin', 3, '{jonas} this is overdue, can we land it today?'),
  C(23, 43, 'mate', 1, 'Using Intl for DST edges, with fixtures for Europe/Paris and America/New_York.'),
  C(24, 45, 'priya', 0, 'Urgent: revoked shares must return 404 on the read path immediately.'),
  C(25, 45, 'admin', 0, 'Agreed, this goes first in the cycle.', { re: 24 }),
  C(26, 46, 'jonas', 1, 'Profiling shows the sort on a non-indexed expression.'),
  C(27, 50, 'maya', 0, 'Starting with the sidebar and the list rows.'),
  C(28, 60, 'priya', 3, 'Fibonacci-like scale: 1, 2, 3, 5, 8.'),
  C(29, 13, 'mate', 2, 'Fixed by keeping the dragged card mounted until the drop settles.'),
  C(30, 39, 'jonas', 3, 'Yes, {admin}. Backoff is in, the failing endpoint banner lands tonight. Reviewing with {priya} tomorrow.', { re: 22 }),
  C(31, 45, 'jonas', 1, '{priya} should the share check also cover the public link route? I see two read paths.'),
  C(32, 45, 'priya', 1, 'Yes, both. I will cover the link route in the same pull request.', { re: 31 }),
  C(33, 45, 'admin', 2, 'Agreed, ship both together.', { re: 31 }),
  C(34, 42, 'priya', 1, '{admin} should the export include comment events or only issue changes?'),
  C(35, 42, 'admin', 2, 'Everything, filtered by date range. Comments too.', { re: 34 }),
  C(36, 36, 'admin', 1, '{priya} are invite links single use? I would like them to expire after 7 days.', { resolved: true }),
  C(37, 36, 'priya', 1, 'Single use, and the 7 day expiry is already in the migration.', { re: 36 }),
  C(38, 47, 'leo', 0, '{admin} I will build on the demo workspace so the smoke test and the screenshots share the same data.'),
  C(39, 38, 'maya', 1, '{jonas} do the skeleton rows need to match the grouped layout too?'),
  C(40, 38, 'jonas', 1, 'Yes, group headers get a skeleton as well, same height as the real header.', { re: 39 }),
  C(41, 34, 'jonas', 4, '{priya} does the bulk endpoint report per-issue results? I want to show partial failures in the toolbar.'),
  C(42, 34, 'priya', 4, 'It returns a list of results with the error code per issue, so partial failures are easy to show.', { re: 41 }),
  C(43, 46, 'priya', 2, 'Is the expression index enough, or do we need a trigram index? {jonas}', { re: 26 }),
  C(44, 46, 'jonas', 2, 'The expression index is enough for titles. Trigram only matters for descriptions.', { re: 26 }),
  C(45, 12, 'jonas', 4, '{maya} grouping now persists with the saved view. Ordering still resets when the view is unsaved.'),
  C(46, 17, 'maya', 5, 'Contrast checked with {leo}: all text tokens pass AA, muted text is borderline on the raised surface.'),
  C(47, 55, 'admin', 0, '{leo} this is the next big one after the cycle, can you scope it?'),
  C(48, 44, 'admin', 1, '{maya} the drag handles should snap to the week, not the day.'),
  C(49, 44, 'maya', 2, 'Snapping to the week makes sense. I will add day precision with Alt.', { re: 48 }),
  C(50, 18, 'maya', 6, 'The mobile sheet variant is in. {admin} ready for your review.'),
];
export const mentionsOf = (body: string): Who[] => [...body.matchAll(/\{(admin|mate|maya|jonas|priya|leo)\}/g)].map((m) => m[1] as Who);
export const commentAt = (m: RichComment) => atDay(issueByKey('DEM', m.n).day + m.after, 4 + (m.k % 4));
export const lastStateChangeAt = (r: RichIssue) => { const len = r.state === 5 ? 2 : r.state; return atDay(r.day + r.age, 3 + len - 1); };
export const issueCreatedAt = (r: RichIssue) => atDay(r.day, 0, (r.n * 7) % 50);
// Instants of the `steps` audit events after an issue's creation: evenly spread (whole minutes) between creation and last state change, strictly increasing, the last being the last state change itself.
export const issueEventTimes = (r: RichIssue, steps: number): string[] => {
  const t0 = Date.parse(issueCreatedAt(r)), t1 = Math.max(Date.parse(lastStateChangeAt(r)), t0 + steps * 60000);
  return Array.from({ length: steps }, (_, j) => new Date(j === steps - 1 ? t1 : t0 + Math.round((((j + 1) / steps) * (t1 - t0)) / 60000) * 60000).toISOString());
};
// Instant of a comment's audit event: never before the last state change of its issue (else the feed shows the comment above the final status). The comment row and its notifications keep commentAt.
export const commentAuditAt = (m: RichComment) => {
  const last = Date.parse(lastStateChangeAt(issueByKey('DEM', m.n))), c = Date.parse(commentAt(m));
  return new Date(c > last ? c : last + (m.k + 1) * 60000).toISOString();
};

/** Inbox of the demo admin. Time-ordered by the seed so that ids (newest = highest) match created_at. */
export type RichNotif = { type: 'assigned' | 'mention' | 'comment' | 'status_change' | 'due_soon'; n: number; actor: Who | null; comment?: number; read: boolean; archived?: boolean; at: string };
const cm = (k: number) => RICH_COMMENTS.find((x) => x.k === k)!;
const onComment = (type: 'mention' | 'comment', k: number, read: boolean, archived = false): RichNotif => ({ type, n: cm(k).n, actor: cm(k).by, comment: k, read, archived, at: commentAt(cm(k)) });
const statusOn = (n: number, actor: Who, read: boolean): RichNotif => ({ type: 'status_change', n, actor, read, at: lastStateChangeAt(issueByKey('DEM', n)) });
export const RICH_NOTIFS: RichNotif[] = ([
  onComment('comment', 4, true, true), onComment('comment', 15, true), onComment('mention', 50, true), onComment('comment', 45, true), onComment('comment', 37, true),
  statusOn(40, 'maya', true), statusOn(36, 'priya', true),
  { type: 'assigned', n: 42, actor: 'priya', read: false, at: atDay(43, 1) },
  { type: 'assigned', n: 47, actor: 'jonas', read: false, at: atDay(44, 1) },
  onComment('comment', 28, false), onComment('mention', 30, false), onComment('mention', 34, false), onComment('mention', 38, false), onComment('comment', 49, false),
  statusOn(60, 'priya', false),
  { type: 'due_soon', n: 45, actor: null, read: false, at: atDay(46, 0) }, { type: 'due_soon', n: 36, actor: null, read: false, at: atDay(46, 1) },
] as RichNotif[]).sort((a, b) => a.at.localeCompare(b.at));

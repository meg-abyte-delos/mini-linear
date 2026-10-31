# Linear parity checklist

One line per Linear feature. Status is read from the repo code on `main` (routes, components, migrations), not guessed. Evidence points at the file that decides the status.

- **present**: shipped end to end (API + UI).
- **partial**: part of it exists (state the gap).
- **missing**: nothing in the repo.
- **API only**: backend exists, no UI found in `src/components`.

Doc base: https://linear.app/docs/ . Re-check a line when you touch the feature; update the status in the same PR.

## Issues

| Feature | Status | Evidence / gap | Linear doc |
|---|---|---|---|
| Create issue (modal, `c`) | present | `NewIssueModal.tsx`, `/api/v1/w/[slug]/issues` | /docs/creating-issues |
| Edit status, priority, assignee, labels, due date | present | `IssueDetail.tsx`, `Picker.tsx` | /docs/creating-issues |
| Custom workflow states per team | partial | `workflow_states` + `/teams/[id]/states`; states are 5 categories, no Triage category | /docs/configuring-workflows |
| Issue relations (blocks, blocked by, related, duplicate) | present | `lib/issues/relations.ts`, `0102_issue_relations.sql` | /docs/issue-relations |
| Sub-issues + progress rollup | present | `0801_a4_subissue_rollup`, `/issues/[id]/sub-issues`, `IssueDetail.tsx` | /docs/parent-and-sub-issues |
| Attachments | present | `0104`, `0805`, `/attachments` routes, `IssueDetail.tsx` | /docs/creating-issues |
| Archive / restore | present | `0105_issues_archive`, `/archive`, `/unarchive`, `/restore` | /docs/creating-issues |
| Issue templates | API only | `0109_a9_issue_templates`, `/teams/[id]/templates`; no template picker in `NewIssueModal.tsx` | /docs/issue-templates |
| Estimates | present | scale in team settings (`/estimate-scale`), picker on detail (`ESTIMATES` in `IssueDetail.tsx`), new issue, Display | /docs/estimates |
| SLAs | missing | no `sla` anywhere | /docs/sla |
| Copy link / branch name / git-branch | present | `IssueDetail.tsx` (branch), `0110_a9_github_integration` | /docs/github-integration |
| Bulk actions (multi-select, `x`, Shift+J/K) | present | `SelectionBar.tsx`, `/issues/bulk`, `lib/shortcuts.ts` | /docs/creating-issues |
| Subscribe / unsubscribe | present | `/issues/[id]/subscription`, `IssueDetail.tsx` | /docs/notifications |
| Move issue between teams | missing | `IssueDetail.tsx` only offers "Move to project" (l.376), no team move | /docs/teams |
| Issue drafts (saved, resumable) | missing | `NewIssueDraft` is only the form state, reset on every open; nothing persisted | /docs/creating-issues |
| Duplicate issue merge flow | partial | relation type `duplicate` + `cancel_source`; no "mark as duplicate" shortcut | /docs/issue-relations |

## Comments

| Feature | Status | Evidence / gap | Linear doc |
|---|---|---|---|
| Comment, edit, delete | present | `/comments/[id]`, `IssueDetail.tsx` | /docs/comment-on-issues |
| Reactions | present | `/comments/[id]/reactions` | /docs/comment-on-issues |
| Mentions (@user) notify | present | `lib/comments/mentions.ts`, `mention-inbox-api.spec.ts` | /docs/comment-on-issues |
| Threaded replies | partial | `parent_comment_id`, Reply button, flat `replies` list. Resolve/unresolve routes exist. Partial: UI in #347 (open); to be switched to present once #347 merges | /docs/comment-on-issues |
| Rich editor (markdown, slash menu) | present | `RichEditor.tsx` | /docs/comment-on-issues |
| Emoji picker in comments | partial | reactions only, no `:emoji:` autocomplete | /docs/comment-on-issues |
| Activity feed | present | `/issues/[id]/activity`, `IssueDetail.tsx` | /docs/creating-issues |

## Triage

| Feature | Status | Evidence / gap | Linear doc |
|---|---|---|---|
| Triage queue / state | missing | no `triage` in src or migrations | /docs/triage |
| Triage responsibility / auto-assign | missing | n/a | /docs/triage |
| Accept / decline / duplicate / snooze from triage | missing | n/a | /docs/triage |

## Inbox / notifications

| Feature | Status | Evidence / gap | Linear doc |
|---|---|---|---|
| Inbox list, read/unread, archive | present | `Inbox.tsx`, `/notifications/*` | /docs/inbox |
| Snooze | present | `/notifications/[id]/snooze`, `Inbox.tsx` | /docs/inbox |
| Bulk actions, archive read, mark all read | present | `/notifications/bulk`, `/archive-read`, `/read-all` | /docs/inbox |
| Reply notification type | partial | server emits `reply` (`0803`), `inbox-client.ts` NotifType lacks it, row renders `undefined` | /docs/notifications |
| Notification preferences | present | `SettingsNotifications.tsx`, `/notification-preferences` | /docs/notifications |
| Inbox filters | partial | filter present, no per-type / per-team filter set | /docs/inbox |
| Email / push / Slack delivery | partial | `digest.ts`, `/internal/notifications/due-soon`; no Slack, no push | /docs/notifications |

## Views, filters, display

| Feature | Status | Evidence / gap | Linear doc |
|---|---|---|---|
| List view | present | `Shell.tsx`, `lib/list-ui.ts` | /docs/display-options |
| Board view + drag and drop | present | `Shell.tsx` (`board`), `ui-board.css`, `dnd.spec.ts` | /docs/display-options |
| Filters (status, priority, assignee, label, project, cycle) | partial | `FilterMenu.tsx`; no creator, due-date, estimate, parent, SLA, AND/OR groups | /docs/filters |
| Grouping | partial | only `status` and `none` (`Grouping` in `list-ui.ts`); no assignee, priority, project, cycle, label | /docs/display-options |
| Sub-grouping | missing | none | /docs/display-options |
| Ordering | present | `list-ui.ts` | /docs/display-options |
| Display properties | present | `DisplayPick.tsx` (Due date, Estimate, Cycle, Updated, sub-issues) | /docs/display-options |
| Saved / custom views | present | `0401_area4_saved_views`, `/views`, `Shell.tsx` | /docs/custom-views |
| Favorites | partial | `/views/favorites` API exists, but `IssueHeaderBar.tsx` stores favorites in localStorage (`ml.fav.<ident>`), not through the API | /docs/favorites |
| Shared / team views | partial | `/views` CRUD; `Shell.tsx` (l.237, 266) sets a shared flag at creation. Gap: editing visibility afterwards | /docs/custom-views |
| My issues | partial | home page pref (`0811`), no dedicated My issues page with tabs | /docs/my-issues |
| Full search + recents | present | `SearchView.tsx`, `/search`, `/search/recents` | /docs/search |
| Peek / split-pane preview | missing | none | /docs/display-options |

## Cycles

| Feature | Status | Evidence / gap | Linear doc |
|---|---|---|---|
| Cycles list and detail | present | `CyclesList.tsx`, `/cycles` | /docs/use-cycles |
| Auto-created cycles, rollover | present | `cycles-schedule.ts`, `/cycles/ensure`, `/cycles/[id]/complete` | /docs/use-cycles |
| Burndown / scope graph | present | `CycleBurndown.tsx`, `/burndown`, `/stats` | /docs/cycle-graph |
| Cycle settings per team | present | `/cycle-settings`, `TeamSettings.tsx` | /docs/use-cycles |
| Cycle filter in views | present | `FILTER_LABEL.cycle` in `Shell.tsx` | /docs/use-cycles |

## Projects

| Feature | Status | Evidence / gap | Linear doc |
|---|---|---|---|
| Projects list and detail | present | `ProjectsList.tsx`, `ProjectDetail.tsx` | /docs/projects |
| Project status, priority, health, dates | present | `0201`, `0807`, `lib/project-health.ts` | /docs/project-status |
| Milestones | present | `/projects/[id]/milestones` | /docs/project-milestones |
| Project updates | present | `/projects/[id]/updates`, `ProjectDetail.tsx` | /docs/project-updates |
| Project progress graph | partial | `ProgressRing.tsx`, rollup; no scope/burn graph | /docs/project-graph |
| Project resources / links | missing | `lib/resources/` holds only server handlers: no route, no `ProjectDetail` UI | /docs/projects |
| Project documents | missing | no documents model | /docs/projects |
| Roadmap (timeline) | partial | list/roadmap toggle in `ProjectsList.tsx` (`lib/roadmap.ts`); no initiative grouping, no drag to reschedule | /docs/projects |
| Initiatives | missing | no `initiative` | /docs/initiatives |

## Workspace, teams, settings

| Feature | Status | Evidence / gap | Linear doc |
|---|---|---|---|
| Teams, members, roles | present | `SettingsTeams.tsx`, `Members.tsx`, `/teams`, `/members` | /docs/teams |
| Sub-teams (hierarchy) | missing | no parent team | /docs/teams |
| Invites (send, revoke, resend, accept) | present | `/invites`, `0107` | /docs/members-roles |
| Guests / limited access | partial | guest workspace role exists (`Members.tsx` invites, Guests tab, `readOnly` in `page.tsx`). Issue shares to guests (`/issues/[id]/shares`) stay API only | /docs/members-roles |
| Labels + label groups | present | `SettingsLabels.tsx`, `/label-groups` | /docs/labels |
| Workspace General (logo, slug, delete) | present | `Settings.tsx`, `0812`, `0813` | /docs/workspaces |
| Profile and preferences | present | `SettingsAccount.tsx`, `0108` | /docs/workspaces |
| Audit log | partial | `/audit`, `audit.ts`; no UI reference in components | /docs/members-roles |
| SSO / SAML, SCIM | missing | none | /docs/members-roles |
| Import (CSV, Jira, GitHub) | missing | none | /docs/import-issues |
| Customer requests | missing | none | /docs/customer-requests |
| Insights (Pulse / analytics) | missing | burndown only | /docs/pulse |

## Shortcuts, command menu

| Feature | Status | Evidence / gap | Linear doc |
|---|---|---|---|
| Single-key shortcuts (c, s, p, a, l, j/k, x, Enter) | present | `lib/shortcuts.ts` registry | https://linear.app/keyboard-shortcuts |
| Sequences (g then i/v/p) | present | `createMatcher` | same |
| `?` overlay | present | `SHORTCUTS` registry | same |
| Cmd+K palette | present | `ui-palette.css`, `Shell.tsx` | https://linear.app/docs/conceptual-model |
| Natural-language commands | present | `lib/nl-command.ts`, `palette-nl.spec.ts` | n/a (extra) |
| Shortcuts: g then m (my issues), g then c (cycles), g then b (inbox), `i` assign to me, `Cmd+Shift+C` copy link | missing | not in `SHORTCUTS` | same |

## Integrations, API

| Feature | Status | Evidence / gap | Linear doc |
|---|---|---|---|
| GitHub (link PRs, branch) | partial | `lib/integrations/github-admin.ts`, `/integrations/github/*`; no UI in `src/components` or settings page | /docs/github-integration |
| Slack | missing | none | /docs/slack |
| Other integrations (Figma, Sentry, Zendesk...) | missing | none | /docs/integration-directory |
| API keys | API only | `/api-keys`; no settings page | /docs/api-and-webhooks |
| Webhooks (+ deliveries, redeliver) | API only | `/webhooks`; no settings page | /docs/api-and-webhooks |
| Realtime sync, presence | present | `lib/sync`, `PresenceStack.tsx` | n/a (extra) |
| Light / dark themes | present | `ui-light.css`, `ui-night.css` | n/a |

## Missing or partial, ranked by user visibility

Ranked by how soon a user would notice on a first session. Rank 1 is the most visible.

1. **Grouping beyond status** (assignee, priority, project, cycle, label) and **sub-grouping**: first thing used on the list.
2. **Filters**: creator, due date, estimate, parent, AND/OR.
3. **Triage**: queue, accept/decline/duplicate.
4. **Inbox `reply` rendering** (row shows `undefined`): a visible bug, small fix.
5. **Issue templates picker** (backend exists).
6. **Peek / split preview** and **My issues** page.
7. **Roadmap**: initiatives, drag to reschedule.
8. **Integrations settings UI**: GitHub, API keys, webhooks (all backend only), then Slack.
9. **SLAs, saved issue drafts.**
10. **Project documents, project graph, Insights.**
11. **Import, SSO/SAML, SCIM, customer requests, sub-teams, audit log UI.**

## Maintenance

Evidence was gathered from file and route presence plus targeted reads. A `present` line means the feature is wired end to end in code, not that its behaviour matches Linear pixel for pixel. Measured Linear UI values are not recorded here (no Linear account access yet). The `linear.app/docs` URLs in the table were not verified, so a path may have moved.

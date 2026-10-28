#!/usr/bin/env bash
# Area 10 perf bench: runs the issue-list query shapes of src/lib/issues/handlers.ts (listIssues) as app_user under RLS
# against a seeded workspace (db/seed/perf-seed.sql) and prints the median execution time of N runs per shape.
#   DATABASE_URL=postgres://app_user:...@host/db scripts/perf/list-bench.sh <workspace_slug> [runs]
set -euo pipefail
SLUG=${1:-perf}; RUNS=${2:-7}
q() { psql "$DATABASE_URL" -qtAX -v ON_ERROR_STOP=1 "$@"; }
# workspaces is RLS'd; resolve the id through the definer lookup the app uses, or pass WS_ID explicitly.
WS=${WS_ID:?set WS_ID to the seeded workspace id (printed by the seed)}
MEMBER=$(q -c "select set_config('app.workspace_id','$WS',false)" -c "select user_id from memberships where role='member' order by user_id limit 1" | tail -1)
TEAM=$(q -c "select set_config('app.workspace_id','$WS',false)" -c "select id from teams order by key limit 1" | tail -1)
PROJ=$(q -c "select set_config('app.workspace_id','$WS',false)" -c "select project_id from issues where project_id is not null group by 1 order by count(*) desc limit 1" | tail -1)
CYC=$(q -c "select set_config('app.workspace_id','$WS',false)" -c "select cycle_id from issues where cycle_id is not null group by 1 order by count(*) desc limit 1" | tail -1)
LBL=$(q -c "select set_config('app.workspace_id','$WS',false)" -c "select label_id from issue_labels group by 1 order by count(*) desc limit 1" | tail -1)
SEL="select i.*, t.key as team_key, coalesce((select array_agg(label_id order by label_id) from issue_labels where issue_id = i.id), '{}') as label_ids from issues i join teams t on t.id = i.team_id and t.workspace_id = i.workspace_id where i.deleted_at is null"
MV="and exists (select 1 from team_memberships tm where tm.team_id = i.team_id and tm.user_id = '$MEMBER')"
ORD="order by i.sort_key asc, i.id asc limit 51"
declare -A SHAPES=(
  [admin_all]="$SEL $ORD"
  [member_all]="$SEL $MV $ORD"
  [admin_team]="$SEL and i.team_id='$TEAM' $ORD"
  [admin_team_status]="$SEL and i.team_id='$TEAM' and i.status='todo' $ORD"
  [board_column_status]="$SEL and i.status='in_progress' $ORD"
  [admin_project]="$SEL and i.project_id='$PROJ' $ORD"
  [admin_cycle]="$SEL and i.cycle_id='$CYC' $ORD"
  [admin_label]="$SEL and exists (select 1 from issue_labels l where l.issue_id = i.id and l.label_id = '$LBL') $ORD"
  [admin_assignee]="$SEL and i.assignee_id='$MEMBER' $ORD"
  [admin_page_20]="$SEL and (i.sort_key, i.id) > ((select sort_key from issues order by sort_key offset 1000 limit 1) collate \"C\", '00000000-0000-0000-0000-000000000000'::uuid) $ORD"
)
printf '%-22s %10s  %s\n' shape median_ms plan_top
for k in $(printf '%s\n' "${!SHAPES[@]}" | sort); do
  ts=()
  for _ in $(seq "$RUNS"); do
    ts+=("$(q -c "select set_config('app.workspace_id','$WS',false)" -c "explain (analyze, format json) ${SHAPES[$k]}" | tail -n +2 | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["Execution Time"])')")
  done
  med=$(printf '%s\n' "${ts[@]}" | sort -n | sed -n "$(( (RUNS+1)/2 ))p")
  top=$(q -c "select set_config('app.workspace_id','$WS',false)" -c "explain ${SHAPES[$k]}" | tail -n +2 | grep -oE '(Index Only Scan|Index Scan|Seq Scan|Bitmap Heap Scan|Sort)( using [a-z_0-9]+)?' | head -2 | paste -sd'>' -)
  printf '%-22s %10.2f  %s\n' "$k" "$med" "$top"
done

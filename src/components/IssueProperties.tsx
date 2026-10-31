'use client';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { STATUSES, STATUS_LABEL, PRIORITY_LABEL, type Issue, type Meta, type Status } from '@/lib/issues';
import { Avatar, PriorityIcon, StatusIcon } from '@/components/icons';
import { Combobox, type ComboOption } from '@/components/ui/Combobox';
import { Tooltip } from '@/components/ui';
import { PropIcon } from '@/components/PropIcons';
import { dueState, identifierOf, DUE_RE } from '@/lib/detail/issue-meta';
import { findPerson, type Person } from '@/lib/people';
// The rail's styles live with the component (the Inbox shows it too, not only the issue route).
import '@/app/issue-detail.css';
import '@/app/ui-issue-detail.css';
import '@/app/ui-issue-page.css';

export type PropKind = 'status' | 'priority' | 'estimate' | 'assignee' | 'labels' | 'project' | 'cycle' | 'parent';
export interface IssuePropertiesHandle { open: (kind: PropKind, el: HTMLElement | null) => void }
const ESTIMATES = [0, 1, 2, 3, 5, 8, 13];
const PICK_TITLE: Record<PropKind, string> = { status: 'Change status', priority: 'Set priority', estimate: 'Set estimate', assignee: 'Assign to', labels: 'Change labels', project: 'Move to project', cycle: 'Move to cycle', parent: 'Set parent issue' };

/**
 * The Properties rail of an issue (Status, Priority, Assignee, Labels / Estimate, Due date, Cycle / Parent, Project / Git), shared by the issue page and the Inbox detail pane.
 * It owns the pickers; every change goes out through `onChange(patch, label)` (the caller applies it optimistically and saves it).
 * `parent` adds the Parent row and `git` the Git group: both are the issue page's, the Inbox leaves them out.
 */
export function IssueProperties({ issue, meta, people, readOnly, today, onChange, parent, git, handle }: {
  issue: Issue; meta: Meta; people: readonly Person[]; readOnly: boolean; today: string;
  onChange: (patch: Partial<Issue>, label: string) => void;
  parent?: { current: Issue | undefined; candidates: Issue[] };
  git?: { branch: string; onCopy: () => void };
  handle?: Ref<IssuePropertiesHandle>;
}) {
  const [pick, setPick] = useState<{ kind: PropKind; el: HTMLElement | null } | null>(null);
  const lastPick = useRef(pick);
  const pickAnchor = useRef<HTMLElement | null>(null);
  useImperativeHandle(handle, () => ({ open: (kind, el) => setPick({ kind, el }) }), []);
  // The Combobox stays mounted so it can animate out; it keeps the last kind while closed.
  if (pick) lastPick.current = pick;
  const shown = pick ?? lastPick.current ?? { kind: 'status' as PropKind, el: null };
  pickAnchor.current = pick?.el ?? null;
  const open = (kind: PropKind) => (e: React.MouseEvent<HTMLButtonElement>) => setPick({ kind, el: e.currentTarget });
  const who = (id: string | null | undefined) => findPerson(people, id);
  const assignee = who(issue.assignee_id);
  const project = meta.projects.find((p) => p.id === issue.project_id);
  const cycle = meta.cycles.find((c) => c.id === issue.cycle_id);
  const due = dueState(issue.due_date, today);
  const dueLabel = issue.due_date ? new Date(`${issue.due_date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Set due date';

  function options(kind: PropKind): ComboOption[] {
    switch (kind) {
      case 'status': return STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s], checked: issue.status === s, lead: <StatusIcon status={s} /> }));
      case 'priority': return PRIORITY_LABEL.map((l, p) => ({ id: String(p), label: l, checked: issue.priority === p, lead: <PriorityIcon priority={p as Issue['priority']} /> }));
      case 'estimate': return [{ id: '', label: 'No estimate', checked: issue.estimate == null }, ...ESTIMATES.map((n) => ({ id: String(n), label: `${n} pt${n === 1 ? '' : 's'}`, checked: issue.estimate === n }))];
      case 'assignee': return [{ id: '', label: 'Unassigned', checked: !issue.assignee_id }, ...people.map((u) => ({ id: u.id, label: u.name, checked: issue.assignee_id === u.id, lead: <Avatar initials={u.initials} hue={u.hue} /> }))];
      case 'labels': return meta.labels.map((l) => ({ id: l.id, label: l.name, checked: issue.label_ids.includes(l.id) }));
      case 'project': return [{ id: '', label: 'No project', checked: !issue.project_id }, ...meta.projects.map((p) => ({ id: p.id, label: p.name, checked: issue.project_id === p.id }))];
      case 'cycle': return [{ id: '', label: 'No cycle', checked: !issue.cycle_id }, ...meta.cycles.map((c) => ({ id: c.id, label: c.name, checked: issue.cycle_id === c.id }))];
      case 'parent': return [{ id: '', label: 'No parent', checked: !issue.parent_id }, ...(parent?.candidates ?? []).map((o) => ({ id: o.id, label: `${identifierOf(o)} ${o.title}`, checked: issue.parent_id === o.id }))];
    }
  }
  function onPick(id: string) {
    if (!pick) return;
    const k = pick.kind;
    if (k !== 'labels') setPick(null);
    if (k === 'status') onChange({ status: id as Status }, `set status to ${STATUS_LABEL[id as Status]}`);
    else if (k === 'priority') onChange({ priority: Number(id) as Issue['priority'] }, `set priority to ${PRIORITY_LABEL[Number(id)] ?? id}`);
    else if (k === 'estimate') onChange({ estimate: id === '' ? null : Number(id) }, id === '' ? 'removed the estimate' : `set estimate to ${id}`);
    else if (k === 'assignee') onChange({ assignee_id: id || null }, id ? `assigned to ${who(id)?.name ?? id}` : 'removed the assignee');
    else if (k === 'labels') { const has = issue.label_ids.includes(id); onChange({ label_ids: has ? issue.label_ids.filter((l) => l !== id) : [...issue.label_ids, id] }, `${has ? 'removed' : 'added'} label ${meta.labels.find((l) => l.id === id)?.name ?? id}`); }
    else if (k === 'project') onChange({ project_id: id || null }, id ? `moved to project ${meta.projects.find((p) => p.id === id)?.name}` : 'removed the project');
    else if (k === 'cycle') onChange({ cycle_id: id || null }, id ? `moved to ${meta.cycles.find((c) => c.id === id)?.name}` : 'removed the cycle');
    else if (k === 'parent') onChange({ parent_id: id || null }, id ? `set parent ${identifierOf(parent?.candidates.find((o) => o.id === id) ?? { id })}` : 'removed the parent');
  }
  const par = parent?.current;

  return (
    <>
        <section className='side-group' aria-labelledby='sg-props'>
          <h3 id='sg-props' className='side-h'>Properties</h3>
          <dl>
          <dt>Status</dt><dd><button disabled={readOnly} onClick={open('status')} aria-haspopup='dialog'><StatusIcon status={issue.status} />{STATUS_LABEL[issue.status]}</button></dd>
          <dt>Priority</dt><dd><button disabled={readOnly} onClick={open('priority')} aria-haspopup='dialog'><PriorityIcon priority={issue.priority} />{PRIORITY_LABEL[issue.priority]}</button></dd>
          <dt>Assignee</dt><dd><button disabled={readOnly} onClick={open('assignee')} aria-haspopup='dialog'>{assignee ? <Avatar initials={assignee.initials} hue={assignee.hue} /> : <PropIcon name='user' />}<span className={assignee ? undefined : 'prop-empty'}>{assignee?.name ?? 'Unassigned'}</span></button></dd>
          <dt>Labels</dt><dd><button disabled={readOnly} onClick={open('labels')} aria-haspopup='dialog'>{issue.label_ids.length ? issue.label_ids.map((l) => { const m = meta.labels.find((x) => x.id === l); return <span key={l} className={`chip ${m?.hue ?? ''}`}>{m?.name ?? l}</span>; }) : <><PropIcon name='label' /><span className='prop-empty'>Add label</span></>}</button></dd>
          </dl>
        </section>
        <section className='side-group' aria-labelledby='sg-plan'>
          <h3 id='sg-plan' className='side-h'>Planning</h3>
          <dl>
          <dt>Estimate</dt><dd><button disabled={readOnly} onClick={open('estimate')} aria-haspopup='dialog' aria-label={`Estimate: ${issue.estimate == null ? 'Set estimate' : `${issue.estimate} pt${issue.estimate === 1 ? '' : 's'}`}`}><PropIcon name='estimate' /><span className={issue.estimate == null ? 'prop-empty' : undefined}>{issue.estimate == null ? 'Set estimate' : `${issue.estimate} pt${issue.estimate === 1 ? '' : 's'}`}</span></button></dd>
          <dt><label htmlFor='prop-due'>Due date</label></dt><dd className='prop-native'><span className={`prop-pill due-${due}`} aria-hidden='true'><PropIcon name='due' /><span className={issue.due_date ? undefined : 'prop-empty'}>{dueLabel}</span>{due === 'overdue' && <span className='due-flag'>Overdue</span>}</span><input id='prop-due' type='date' disabled={readOnly} value={issue.due_date ?? ''} onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* not supported */ } }} onChange={(e) => { const v = e.target.value; if (v && !DUE_RE.test(v)) return; onChange({ due_date: v || null }, v ? `set due date to ${v}` : 'removed the due date'); }} /></dd>
          <dt>Cycle</dt><dd><button disabled={readOnly} onClick={open('cycle')} aria-haspopup='dialog'><PropIcon name='cycle' /><span className={cycle ? 'prop-trunc' : 'prop-empty'} title={cycle?.name}>{cycle?.name ?? 'Add to cycle'}</span></button></dd>
          </dl>
        </section>
        <section className='side-group' aria-labelledby='sg-org'>
          <h3 id='sg-org' className='side-h'>Organization</h3>
          <dl>
          {parent && <><dt>Parent</dt><dd><button disabled={readOnly} onClick={open('parent')} aria-haspopup='dialog'><PropIcon name='parent' /><span className={par ? 'prop-trunc' : 'prop-empty'} title={par ? `${identifierOf(par)} ${par.title}` : undefined}>{par ? `${identifierOf(par)} ${par.title}` : 'Set parent'}</span></button></dd></>}
          <dt>Project</dt><dd><button disabled={readOnly} onClick={open('project')} aria-haspopup='dialog'><PropIcon name='project' /><span className={project ? 'prop-trunc' : 'prop-empty'} title={project?.name}>{project?.name ?? 'Add to project'}</span></button></dd>
          </dl>
        </section>
        {git && (
        <section className='side-group' aria-labelledby='sg-git'>
          <h3 id='sg-git' className='side-h'>Git</h3>
          <dl>
          <dt>Branch</dt><dd><Tooltip label={git.branch}><button className='branch-btn' onClick={git.onCopy} aria-label={`Copy branch name ${git.branch}`}><PropIcon name='branch' /><code className='branch'>{git.branch}</code><span className='branch-copy'><PropIcon name='copy' /></span></button></Tooltip></dd>
          </dl>
        </section>
        )}
      <Combobox open={!!pick} anchorRef={pickAnchor} onClose={() => setPick(null)} matchWidth label={PICK_TITLE[shown.kind]} multi={shown.kind === 'labels'} numbered={shown.kind === 'status'} startOnChecked={shown.kind === 'status'} options={options(shown.kind)} onPick={onPick} />
    </>
  );
}

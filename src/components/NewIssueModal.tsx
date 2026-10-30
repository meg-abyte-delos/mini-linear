'use client';
// Linear-style "New issue" modal: title, WYSIWYG description, property chips on ui/Combobox, Create more, Cmd+Enter, Esc, focus trap.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Combobox, Kbd, type ComboOption } from '@/components/ui';
import { useExitMount } from '@/components/ui/useExitMount';
import { RichEditor } from '@/components/RichEditor';
import { Avatar, PriorityIcon, StatusIcon, UnassignedIcon } from '@/components/icons';
import { PropIcon } from '@/components/PropIcons';
import { PRIORITY_LABEL, STATUSES, STATUS_LABEL, type Issue, type Status } from '@/lib/issues';
import type { Team } from '@/lib/settings-client';
import type { Person } from '@/lib/people';

export interface NewIssueDraft { title: string; description: string; status: Status; priority: Issue['priority']; assignee_id: string | null; label_ids: string[]; project_id: string | null; team_id: string }
interface Named { id: string; name: string; hue?: string }
interface Props { open: boolean; initialStatus?: Status; people: readonly Person[]; labels: readonly Named[]; projects: readonly Named[]; teams?: readonly Team[]; teamId?: string; onClose: () => void; onSubmit: (d: NewIssueDraft) => Promise<boolean> }
type Kind = 'team' | 'status' | 'priority' | 'assignee' | 'labels' | 'project';
const TITLES: Record<Kind, string> = { team: 'Select team', status: 'Set status', priority: 'Set priority', assignee: 'Assign to', labels: 'Add labels', project: 'Add to project' };
const FOCUSABLE = 'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), [contenteditable="true"]';

export function NewIssueModal({ open, initialStatus, people, labels, projects, teams = [], teamId = '', onClose, onSubmit }: Props) {
  const { mounted, state } = useExitMount(open);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<Status>('todo');
  const [priority, setPriority] = useState<Issue['priority']>(0);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [team, setTeam] = useState(teamId);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // sync guard: state alone lets a double Cmd+Enter through before re-render
  const [invalid, setInvalid] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [pick, setPick] = useState<Kind | null>(null);
  const lastPick = useRef<Kind>('status');
  const anchor = useRef<HTMLElement | null>(null);
  const desc = useRef('');
  const dlg = useRef<HTMLDivElement>(null);
  const titleEl = useRef<HTMLInputElement>(null);
  const pickOpen = useRef(false);
  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  pickOpen.current = pick !== null;
  const titleId = useId();

  // Fresh draft on every open (render-time reset, same pattern as Combobox).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setTitle(''); setStatus(initialStatus ?? 'todo'); setPriority(0); setAssignee(null); setLabelIds([]); setProject(null); setTeam(teamId); busyRef.current = false; setBusy(false); setInvalid(false); setPick(null); setEditorKey((k) => k + 1); desc.current = ''; }
  }

  useEffect(() => {
    if (!open || !mounted) return;
    const opener = document.activeElement as HTMLElement | null;
    titleEl.current?.focus();
    // aria-modal alone does not keep Tab or screen readers out of the page: everything else is inert while the modal is open.
    const scrim = dlg.current?.parentElement;
    const others = Array.from(document.body.children).filter((n): n is HTMLElement => n instanceof HTMLElement && n !== scrim && !n.hasAttribute('inert'));
    others.forEach((n) => n.setAttribute('inert', ''));
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape') {
        if (pickOpen.current || t?.closest('.re-link')) return; // the picker / link form closes first
        e.stopPropagation(); e.preventDefault(); closeFn.current(); return;
      }
      if (e.key !== 'Tab' || !t || !dlg.current?.contains(t)) return;
      const f = Array.from(dlg.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!f.length) return;
      const first = f[0] as HTMLElement, last = f[f.length - 1] as HTMLElement;
      if (e.shiftKey && (t === first || !f.some((x) => x === t || x.contains(t)))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (t === last || last.contains(t))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); others.forEach((n) => n.removeAttribute('inert')); opener?.focus?.(); };
  }, [open, mounted]);

  async function submit() {
    if (busyRef.current) return;
    const t = title.trim();
    if (!t) { setInvalid(true); titleEl.current?.focus(); return; }
    busyRef.current = true;
    setBusy(true);
    let ok = false;
    try { ok = await onSubmit({ title: t.slice(0, 255), description: desc.current, status, priority, assignee_id: assignee, label_ids: labelIds, project_id: project, team_id: team }); }
    finally { busyRef.current = false; setBusy(false); }
    if (!ok) return;
    if (!more) { onClose(); return; }
    setTitle(''); setInvalid(false); desc.current = ''; setEditorKey((k) => k + 1); titleEl.current?.focus();
  }

  const person = people.find((p) => p.id === assignee);
  const curTeam = teams.find((t) => t.id === team) ?? teams[0];
  const proj = projects.find((p) => p.id === project);
  const chosen = labels.filter((l) => labelIds.includes(l.id));
  const options = (k: Kind): ComboOption[] => {
    if (k === 'team') return teams.map((t) => ({ id: t.id, label: t.name, checked: t.id === team }));
    if (k === 'status') return STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s], checked: s === status, lead: <StatusIcon status={s} /> }));
    if (k === 'priority') return PRIORITY_LABEL.map((l, n) => ({ id: String(n), label: l, checked: n === priority, lead: <PriorityIcon priority={n as Issue['priority']} /> }));
    if (k === 'assignee') return [{ id: 'none', label: 'Unassigned', checked: assignee === null, lead: <UnassignedIcon /> }, ...people.map((u) => ({ id: u.id, label: u.name, checked: assignee === u.id, lead: <Avatar initials={u.initials} hue={u.hue} /> }))];
    if (k === 'labels') return labels.map((l) => ({ id: l.id, label: l.name, checked: labelIds.includes(l.id), lead: <span className={`chip ${l.hue ?? ''}`} aria-hidden='true'>&nbsp;</span> }));
    return [{ id: 'none', label: 'No project', checked: project === null }, ...projects.map((p) => ({ id: p.id, label: p.name, checked: project === p.id }))];
  };
  const onPick = (id: string) => {
    const k = lastPick.current;
    if (k === 'team') setTeam(id);
    else if (k === 'status') setStatus(id as Status);
    else if (k === 'priority') setPriority(Number(id) as Issue['priority']);
    else if (k === 'assignee') setAssignee(id === 'none' ? null : id);
    else if (k === 'labels') setLabelIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
    else setProject(id === 'none' ? null : id);
  };
  const openPick = (k: Kind) => (e: React.MouseEvent<HTMLButtonElement>) => { anchor.current = e.currentTarget; lastPick.current = k; setPick(k); };

  if (typeof document === 'undefined') return null;
  const shown = pick ?? lastPick.current;
  return (
    <>
      {mounted && createPortal(
        <div className='ni-scrim' data-state={state} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <div
            ref={dlg} className='ni' role='dialog' aria-modal='true' aria-labelledby={titleId} data-state={state}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
          >
            <div className='ni-top'>
              {curTeam && <button type='button' className='ni-team' aria-haspopup='dialog' aria-label={curTeam.name + ' team'} onClick={openPick('team')}>{curTeam.key}<span className='ni-caret' aria-hidden='true'>›</span></button>}
              <h2 id={titleId} className='ni-head'>New issue</h2>
              <button type='button' className='ni-x' aria-label='Close' onClick={onClose}><svg width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' aria-hidden='true'><path d='M4 4l8 8M12 4l-8 8' /></svg></button>
            </div>
            <input
              ref={titleEl} className='ni-title' aria-label='Issue title' placeholder='Issue title' maxLength={255} value={title}
              aria-invalid={invalid || undefined} onChange={(e) => { setTitle(e.target.value); if (invalid) setInvalid(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault(); }}
            />
            {invalid && <p className='ni-err' role='alert'>A title is required.</p>}
            <div className='ni-desc'><RichEditor key={editorKey} value='' floating onCommit={(md) => { desc.current = md; }} label='Description' placeholder='Add description…' /></div>
            <div className='ni-props' role='group' aria-label='Properties'>
              <button type='button' className='ni-prop' aria-haspopup='dialog' onClick={openPick('status')}><StatusIcon status={status} />{STATUS_LABEL[status]}</button>
              <button type='button' className='ni-prop' aria-haspopup='dialog' onClick={openPick('priority')}><PriorityIcon priority={priority} />{PRIORITY_LABEL[priority]}</button>
              <button type='button' className='ni-prop' aria-haspopup='dialog' onClick={openPick('assignee')}>{person ? <Avatar initials={person.initials} hue={person.hue} /> : <PropIcon name='user' />}<span className={person ? undefined : 'ni-empty'}>{person?.name ?? 'Assignee'}</span></button>
              <button type='button' className='ni-prop' aria-haspopup='dialog' onClick={openPick('labels')}>{chosen.length ? chosen.map((l) => <span key={l.id} className={`chip ${l.hue ?? ''}`}>{l.name}</span>) : <><PropIcon name='label' /><span className='ni-empty'>Labels</span></>}</button>
              <button type='button' className='ni-prop' aria-haspopup='dialog' onClick={openPick('project')}><PropIcon name='project' /><span className={proj ? undefined : 'ni-empty'}>{proj?.name ?? 'Project'}</span></button>
            </div>
            <div className='ni-foot'>
              <label className='ni-more'><input type='checkbox' role='switch' checked={more} onChange={(e) => setMore(e.target.checked)} />Create more</label>
              <span className='ni-hint'><Kbd keys={['⌘', '↵']} /></span>
              <button type='button' className='dlg-btn dlg-confirm' disabled={busy} onClick={() => void submit()}>Create issue</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <Combobox open={pick !== null && open} anchorRef={anchor} onClose={() => setPick(null)} label={TITLES[shown]} multi={shown === 'labels'} options={options(shown)} onPick={onPick} />
    </>
  );
}

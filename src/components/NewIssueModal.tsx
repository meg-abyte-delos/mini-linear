'use client';
// Linear-style "New issue" modal: title, WYSIWYG description, property chips on ui/Combobox, Create more, Cmd+Enter, Esc, focus trap.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Combobox, Toggle, type ComboOption } from '@/components/ui';
import { useExitMount } from '@/components/ui/useExitMount';
import { RichEditor } from '@/components/RichEditor';
import { Avatar, Icon, PriorityIcon, StatusIcon, UnassignedIcon } from '@/components/icons';
import { PropIcon } from '@/components/PropIcons';
import { PRIORITY_LABEL, STATUSES, STATUS_LABEL, type Issue, type Status } from '@/lib/issues';
import type { Team } from '@/lib/settings-client';
import type { Person } from '@/lib/people';
import { safeHref } from '@/lib/detail/markdown';

const ESTIMATES = [0, 1, 2, 3, 5, 8, 13];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface NewIssueDraft { title: string; description: string; status: Status; priority: Issue['priority']; assignee_id: string | null; label_ids: string[]; project_id: string | null; team_id: string; estimate: number | null; due_date: string | null; cycle_id: string | null; links: { url: string; title: string }[] }
interface Named { id: string; name: string; hue?: string }
interface Props { open: boolean; initialStatus?: Status; people: readonly Person[]; labels: readonly Named[]; projects: readonly Named[]; cycles?: readonly { id: string; name: string }[]; fullFields?: boolean; teams?: readonly Team[]; teamId?: string; onClose: () => void; onSubmit: (d: NewIssueDraft) => Promise<boolean> }
type Kind = 'team' | 'status' | 'priority' | 'assignee' | 'labels' | 'project' | 'more' | 'estimate' | 'cycle';
const TITLES: Record<Kind, string> = { team: 'Select team', status: 'Set status', priority: 'Set priority', assignee: 'Assign to', labels: 'Add labels', project: 'Add to project', more: 'More properties', estimate: 'Set estimate', cycle: 'Add to cycle' };
const FOCUSABLE = 'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), [contenteditable="true"]';

export function NewIssueModal({ open, initialStatus, people, labels, projects, cycles = [], fullFields = false, teams = [], teamId = '', onClose, onSubmit }: Props) {
  const { mounted, state } = useExitMount(open);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<Status>('todo');
  const [priority, setPriority] = useState<Issue['priority']>(0);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [team, setTeam] = useState(teamId);
  const [more, setMore] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [cycle, setCycle] = useState<string | null>(null);
  const [shown2, setShown2] = useState<{ estimate: boolean; due: boolean; cycle: boolean }>({ estimate: false, due: false, cycle: false });
  const [links, setLinks] = useState<{ url: string; title: string }[]>([]);
  const [linkForm, setLinkForm] = useState<{ url: string; title: string } | null>(null);
  const [linkErr, setLinkErr] = useState(false);
  const dueEl = useRef<HTMLInputElement>(null);
  const linkEl = useRef<HTMLInputElement>(null);
  const clipEl = useRef<HTMLButtonElement>(null);
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
    if (open) { setTitle(''); setStatus(initialStatus ?? 'todo'); setPriority(0); setAssignee(null); setLabelIds([]); setProject(null); setTeam(teamId); setExpanded(false); setEstimate(null); setDue(null); setCycle(null); setShown2({ estimate: false, due: false, cycle: false }); setLinks([]); setLinkForm(null); setLinkErr(false); busyRef.current = false; setBusy(false); setInvalid(false); setPick(null); setEditorKey((k) => k + 1); desc.current = ''; }
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
    try { ok = await onSubmit({ title: t.slice(0, 255), description: desc.current, status, priority, assignee_id: assignee, label_ids: labelIds, project_id: project, team_id: team, estimate, due_date: due, cycle_id: cycle, links }); }
    finally { busyRef.current = false; setBusy(false); }
    if (!ok) return;
    if (!more) { onClose(); return; }
    setTitle(''); setInvalid(false); setLinks([]); setLinkForm(null); setEstimate(null); setDue(null); setCycle(null); setShown2({ estimate: false, due: false, cycle: false }); desc.current = ''; setEditorKey((k) => k + 1); titleEl.current?.focus();
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
    if (k === 'more') return [...(fullFields ? [{ id: 'estimate', label: 'Estimate', lead: <PropIcon name='estimate' /> }, { id: 'due', label: 'Due date', lead: <PropIcon name='due' /> }] : []), { id: 'cycle', label: 'Cycle', lead: <PropIcon name='cycle' /> }];
    if (k === 'estimate') return [{ id: 'none', label: 'No estimate', checked: estimate === null }, ...ESTIMATES.map((n) => ({ id: String(n), label: `${n} pt${n === 1 ? '' : 's'}`, checked: estimate === n }))];
    if (k === 'cycle') return [{ id: 'none', label: 'No cycle', checked: cycle === null }, ...cycles.map((c) => ({ id: c.id, label: c.name, checked: cycle === c.id }))];
    return [{ id: 'none', label: 'No project', checked: project === null }, ...projects.map((p) => ({ id: p.id, label: p.name, checked: project === p.id }))];
  };
  const onPick = (id: string) => {
    const k = lastPick.current;
    if (k === 'team') { if (id !== team) setCycle(null); setTeam(id); } // cycles belong to one team: never carry one across
    else if (k === 'status') setStatus(id as Status);
    else if (k === 'priority') setPriority(Number(id) as Issue['priority']);
    else if (k === 'assignee') setAssignee(id === 'none' ? null : id);
    else if (k === 'more') {
      // The picker closes itself after a pick: open the chosen property one tick later so it is not closed with it.
      setShown2((c) => ({ ...c, [id]: true }));
      if (id === 'due') setTimeout(() => dueEl.current?.focus(), 0);
      else setTimeout(() => { lastPick.current = id as Kind; setPick(id as Kind); }, 0);
    }
    else if (k === 'estimate') setEstimate(id === 'none' ? null : Number(id));
    else if (k === 'cycle') setCycle(id === 'none' ? null : id);
    else if (k === 'labels') setLabelIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
    else setProject(id === 'none' ? null : id);
  };
  const addLink = () => {
    if (!linkForm) return;
    const url = safeHref(linkForm.url);
    if (!url || !/^https?:/i.test(url)) { setLinkErr(true); linkEl.current?.focus(); return; }
    setLinks((l) => [...l, { url, title: linkForm.title.trim() || url }]); setLinkForm(null); setLinkErr(false); clipEl.current?.focus(); // the form unmounts: keep focus (and Cmd+Enter) inside the dialog
  };
  const openPick = (k: Kind) => (e: React.MouseEvent<HTMLButtonElement>) => { anchor.current = e.currentTarget; lastPick.current = k; setPick(k); };

  if (typeof document === 'undefined') return null;
  const shown = pick ?? lastPick.current;
  return (
    <>
      {mounted && createPortal(
        <div className='ni-scrim' data-state={state} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <div
            ref={dlg} className='ni' role='dialog' aria-modal='true' aria-labelledby={titleId} data-state={state} data-expanded={expanded || undefined}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
          >
            <div className='ni-top'>
              {curTeam && <button type='button' className='ni-team' aria-haspopup='dialog' aria-label={curTeam.name + ' team'} onClick={openPick('team')}><Icon name='team' size={14} />{curTeam.key}<span className='ni-caret' aria-hidden='true'>›</span></button>}
              <h2 id={titleId} className='ni-head'>New issue</h2>
              <button type='button' className='ni-x' aria-label={expanded ? 'Collapse' : 'Expand'} title={expanded ? 'Collapse' : 'Expand'} aria-pressed={expanded} onClick={() => setExpanded((x) => !x)}>
                <svg width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>{expanded ? <path d='M13 3l-3.5 3.5M9.5 4v2.5H12M3 13l3.5-3.5M6.5 12V9.5H4' /> : <path d='M10 3h3v3M13 3L9.5 6.5M6 13H3v-3M3 13l3.5-3.5' />}</svg>
              </button>
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
              {shown2.estimate && <button type='button' className='ni-prop' aria-haspopup='dialog' onClick={openPick('estimate')}><PropIcon name='estimate' /><span className={estimate === null ? 'ni-empty' : undefined}>{estimate === null ? 'Estimate' : `${estimate} pt${estimate === 1 ? '' : 's'}`}</span></button>}
              {shown2.due && <label className='ni-prop ni-date'><PropIcon name='due' /><span className='sr-only'>Due date</span><input ref={dueEl} type='date' aria-label='Due date' value={due ?? ''} onChange={(e) => { const v = e.target.value; if (!v || DATE_RE.test(v)) setDue(v || null); }} /></label>}
              {shown2.cycle && <button type='button' className='ni-prop' aria-haspopup='dialog' onClick={openPick('cycle')}><PropIcon name='cycle' /><span className={cycle ? undefined : 'ni-empty'}>{cycles.find((c) => c.id === cycle)?.name ?? 'Cycle'}</span></button>}
              <button type='button' className='ni-prop ni-prop-more' aria-haspopup='dialog' aria-label='More properties' title='More properties' onClick={openPick('more')}><Icon name='more' size={16} /></button>
            </div>
            {linkForm && (<form className='ni-link' noValidate onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); addLink(); }}><input ref={linkEl} autoFocus type='url' aria-label='Link URL' aria-invalid={linkErr || undefined} placeholder='https://…' value={linkForm.url} onChange={(e) => { setLinkErr(false); setLinkForm({ ...linkForm, url: e.target.value }); }} /><input aria-label='Link title' placeholder='Title (optional)' value={linkForm.title} onChange={(e) => setLinkForm({ ...linkForm, title: e.target.value })} /><button type='submit' className='ni-prop'>Attach</button><button type='button' className='ni-prop' onClick={() => { setLinkForm(null); setLinkErr(false); clipEl.current?.focus(); }}>Cancel</button></form>)}
            {linkErr && <p className='ni-err' role='alert'>Enter a valid http(s) URL.</p>}
            {links.length > 0 && <ul className='ni-links' aria-label='Attachments'>{links.map((l, n) => <li key={l.url + n}><span className='ni-link-t'>{l.title}</span><button type='button' aria-label={`Remove attachment ${l.title}`} onClick={() => setLinks((x) => x.filter((_, i) => i !== n))}>×</button></li>)}</ul>}
            <div className='ni-foot'>
              <button ref={clipEl} type='button' className='ni-attach' aria-label='Attach link' title='Attach link' onClick={() => { setLinkErr(false); setLinkForm((f) => f ?? { url: '', title: '' }); }}><Icon name='attach' size={16} /></button>
              <span className='ni-more'><Toggle checked={more} onChange={(e) => setMore(e.target.checked)} label='Create more' /></span>
              <Button variant='primary' title='Create issue (⌘↵)' aria-keyshortcuts='Meta+Enter Control+Enter' loading={busy} onClick={() => void submit()}>Create issue</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <Combobox open={pick !== null && open} anchorRef={anchor} onClose={() => setPick(null)} label={TITLES[shown]} multi={shown === 'labels'} options={options(shown)} onPick={onPick} />
    </>
  );
}

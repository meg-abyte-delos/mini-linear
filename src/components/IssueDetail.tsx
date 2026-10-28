'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUSES, STATUS_LABEL, PRIORITY_LABEL, USERS, fmtDate, type Issue, type Meta, type Status } from '@/lib/issues';
import { Avatar, PriorityIcon, StatusIcon } from '@/components/icons';
import { Picker, type PickOption } from '@/components/Picker';
import { Markdown } from '@/components/Markdown';
import { patchIssue } from '@/lib/api-client';
import { detailApi, type Attachment, type Comment, type Relation, type ActivityItem } from '@/lib/detail/api';
import { branchName, dueState, identifierOf, issueUrl, progress, DUE_RE } from '@/lib/detail/issue-meta';
import { activeMention, insertMention, suggest, type MentionUser } from '@/lib/detail/mentions';
import { safeHref } from '@/lib/detail/markdown';

export type DetailIssue = Issue & { estimate?: number | null; due_date?: string | null; archived_at?: string | null; branch_name?: string; url?: string };
type PickKind = 'status' | 'priority' | 'assignee' | 'labels' | 'project' | 'cycle' | 'parent' | 'relation';
const REL_LABEL: Record<Relation['type'], string> = { blocks: 'Blocks', blocked_by: 'Blocked by', related: 'Related to', duplicate: 'Duplicate of' };
const ESTIMATES = [0, 1, 2, 3, 5, 8, 13];
const EMOJIS = ['👍', '🎉', '❤️', '👀'];
const MENTION_USERS: MentionUser[] = USERS.map((u) => ({ id: u.id, name: u.name, handle: u.name.split(' ')[0]?.toLowerCase() ?? u.id }));
const ME = USERS[0].id;
let seq = 0;
const lid = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;
const now = () => new Date().toISOString();
const who = (id: string | null | undefined) => USERS.find((u) => u.id === id);
const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

function wrapSel(el: HTMLTextAreaElement, before: string, after = before, placeholder = 'text'): string {
  const { selectionStart: s, selectionEnd: e, value } = el;
  const sel = value.slice(s, e) || placeholder;
  return value.slice(0, s) + before + sel + after + value.slice(e);
}

export function IssueDetail({ slug, initial, all, meta, api, today }: { slug: string; initial: DetailIssue; all: DetailIssue[]; meta: Meta; api: boolean; today: string }) {
  const [issue, setIssue] = useState<DetailIssue>(initial);
  const [others, setOthers] = useState<DetailIssue[]>(all.filter((i) => i.id !== initial.id));
  const [title, setTitle] = useState(initial.title);
  const [desc, setDesc] = useState(initial.description);
  const [tab, setTab] = useState<'write' | 'preview'>(initial.description ? 'preview' : 'write');
  const [pick, setPick] = useState<{ kind: PickKind; rect: DOMRect | null; relType?: Relation['type'] } | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([{ id: 'a0', actor: initial.assignee_id, action: 'created the issue', created_at: initial.created_at }]);
  const [toast, setToast] = useState<string | null>(null);
  const [linkForm, setLinkForm] = useState<{ url: string; title: string } | null>(null);
  const [relMenu, setRelMenu] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const version = useRef(initial.version);
  const client = useMemo(() => (api ? detailApi(slug) : null), [api, slug]);
  const ident = identifierOf(issue);
  const branch = issue.branch_name || branchName(ident, issue.title);
  const children = others.filter((i) => i.parent_id === issue.id && !i.deleted_at);
  const parent = others.find((i) => i.id === issue.parent_id);
  const byId = (id: string) => others.find((i) => i.id === id);

  // Feature-detected loads: endpoints not on main yet keep the local (empty) state.
  useEffect(() => {
    if (!client) return;
    void client.relations(issue.id).then((r) => r.ok && setRelations(r.data.items));
    void client.attachments(issue.id).then((r) => r.ok && setAttachments(r.data.items));
    void client.comments(issue.id).then((r) => r.ok && setComments(r.data.items));
    void client.activity(issue.id).then((r) => r.ok && r.data.items.length && setActivity(r.data.items));
  }, [client, issue.id]);

  useEffect(() => { document.documentElement.dataset.ready = '1'; }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t); }, [toast]);

  const log = (action: string, diff?: ActivityItem['diff']) => setActivity((a) => [...a, { id: lid('a'), actor: ME, action, diff, created_at: now() }]);

  async function update(patch: Partial<DetailIssue>, label: string) {
    const prev = issue;
    const next = { ...issue, ...patch, version: issue.version + 1 };
    setIssue(next);
    log(label, Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { from: (prev as unknown as Record<string, unknown>)[k], to: v }])));
    if (!api) return;
    const r = await patchIssue(slug, prev, version.current, patch as Record<string, unknown>);
    if (r.issue) { version.current = r.issue.version; if (r.kind !== 'ok') setIssue(r.issue); }
    if (r.kind === 'conflict') setToast('Issue modified elsewhere. Reloaded the latest version.');
    else if (r.kind === 'error') setToast('Could not save the change.');
  }

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); setToast(`Copied ${what}`); } catch { setToast(`Copy failed: ${text}`); }
  }
  const copyLink = () => copy(issue.url || issueUrl(window.location.origin, slug, ident), 'issue URL');
  const copyBranch = () => copy(branch, 'branch name');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== '.' && e.key !== '>') return;
      e.preventDefault();
      if (e.shiftKey) void copyBranch(); else void copyLink();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function saveTitle() {
    const t = title.trim();
    if (!t) { setTitle(issue.title); setToast('Title cannot be empty'); return; }
    if (t !== issue.title) void update({ title: t.slice(0, 255) }, 'changed the title');
  }
  function saveDesc() { if (desc !== issue.description) void update({ description: desc }, 'updated the description'); }
  function tool(kind: 'b' | 'i' | 'code' | 'link' | 'ul' | 'task') {
    const el = descRef.current; if (!el) return;
    const v = kind === 'b' ? wrapSel(el, '**') : kind === 'i' ? wrapSel(el, '_') : kind === 'code' ? wrapSel(el, '`') : kind === 'link' ? wrapSel(el, '[', '](https://)', 'link') : kind === 'ul' ? wrapSel(el, '\n- ', '', 'item') : wrapSel(el, '\n- [ ] ', '', 'task');
    setDesc(v); el.focus();
  }

  function options(kind: PickKind): PickOption[] {
    switch (kind) {
      case 'status': return STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s], checked: issue.status === s, lead: <StatusIcon status={s} /> }));
      case 'priority': return PRIORITY_LABEL.map((l, p) => ({ id: String(p), label: l, checked: issue.priority === p, lead: <PriorityIcon priority={p as Issue['priority']} /> }));
      case 'assignee': return [{ id: '', label: 'Unassigned', checked: !issue.assignee_id }, ...USERS.map((u) => ({ id: u.id, label: u.name, checked: issue.assignee_id === u.id, lead: <Avatar initials={u.initials} hue={u.hue} /> }))];
      case 'labels': return meta.labels.map((l) => ({ id: l.id, label: l.name, checked: issue.label_ids.includes(l.id) }));
      case 'project': return [{ id: '', label: 'No project', checked: !issue.project_id }, ...meta.projects.map((p) => ({ id: p.id, label: p.name, checked: issue.project_id === p.id }))];
      case 'cycle': return [{ id: '', label: 'No cycle', checked: !issue.cycle_id }, ...meta.cycles.map((c) => ({ id: c.id, label: c.name, checked: issue.cycle_id === c.id }))];
      case 'parent': return [{ id: '', label: 'No parent', checked: !issue.parent_id }, ...others.filter((o) => o.parent_id !== issue.id && !o.deleted_at).map((o) => ({ id: o.id, label: `${identifierOf(o)} ${o.title}`, checked: issue.parent_id === o.id }))];
      case 'relation': return others.filter((o) => !o.deleted_at && !relations.some((r) => r.related_issue_id === o.id)).map((o) => ({ id: o.id, label: `${identifierOf(o)} ${o.title}` }));
    }
  }
  async function onPick(id: string) {
    if (!pick) return;
    const k = pick.kind;
    if (k !== 'labels') setPick(null);
    if (k === 'status') void update({ status: id as Status }, `set status to ${STATUS_LABEL[id as Status]}`);
    else if (k === 'priority') void update({ priority: Number(id) as Issue['priority'] }, `set priority to ${PRIORITY_LABEL[Number(id)] ?? id}`);
    else if (k === 'assignee') void update({ assignee_id: id || null }, id ? `assigned to ${who(id)?.name ?? id}` : 'removed the assignee');
    else if (k === 'labels') { const has = issue.label_ids.includes(id); void update({ label_ids: has ? issue.label_ids.filter((l) => l !== id) : [...issue.label_ids, id] }, `${has ? 'removed' : 'added'} label ${meta.labels.find((l) => l.id === id)?.name ?? id}`); }
    else if (k === 'project') void update({ project_id: id || null }, id ? `moved to project ${meta.projects.find((p) => p.id === id)?.name}` : 'removed the project');
    else if (k === 'cycle') void update({ cycle_id: id || null }, id ? `moved to ${meta.cycles.find((c) => c.id === id)?.name}` : 'removed the cycle');
    else if (k === 'parent') void update({ parent_id: id || null }, id ? `set parent ${identifierOf(byId(id) ?? { id })}` : 'removed the parent');
    else if (k === 'relation' && pick.relType) {
      const type = pick.relType;
      const local: Relation = { id: lid('r'), type, issue_id: issue.id, related_issue_id: id };
      const r = client ? await client.addRelation(issue.id, type, id) : null;
      if (r && !r.ok && !r.unsupported) { setToast('Could not add the relation'); return; }
      setRelations((x) => [...x, r && r.ok ? r.data : local]);
      log(`marked as ${REL_LABEL[type].toLowerCase()} ${identifierOf(byId(id) ?? { id })}`);
    }
  }
  async function removeRelation(rel: Relation) {
    const r = client ? await client.removeRelation(issue.id, rel.id) : null;
    if (r && !r.ok && !r.unsupported) { setToast('Could not remove the relation'); return; }
    setRelations((x) => x.filter((y) => y.id !== rel.id));
    log('removed a relation');
  }

  function addSubIssue(t: string) {
    const n = others.length + 2000;
    const child: DetailIssue = { ...issue, id: `${ident.split('-')[0] ?? 'DEL'}-${n}`, identifier: undefined, title: t, description: '', status: 'todo', parent_id: issue.id, label_ids: [], version: 1, created_at: now(), deleted_at: null, archived_at: null };
    setOthers((o) => [...o, child]);
    log(`added sub-issue ${child.id}`);
  }

  async function lifecycle(action: 'archive' | 'unarchive' | 'delete' | 'restore') {
    const r = client ? await (action === 'delete' ? client.remove(issue.id) : action === 'restore' ? client.restore(issue.id) : client.archive(issue.id, action === 'archive')) : null;
    if (r && !r.ok && !r.unsupported) { setToast(`Could not ${action} the issue`); return; }
    const patch = action === 'archive' ? { archived_at: now() } : action === 'unarchive' ? { archived_at: null } : action === 'delete' ? { deleted_at: now() } : { deleted_at: null };
    setIssue((i) => ({ ...i, ...patch }));
    log(action === 'delete' ? 'deleted the issue' : `${action}d the issue`);
    setToast(action === 'delete' ? 'Issue moved to trash' : `Issue ${action}d`);
  }

  async function addLink() {
    if (!linkForm) return;
    const url = safeHref(linkForm.url);
    if (!url || !/^https?:/i.test(url)) { setToast('Enter a valid http(s) URL'); return; }
    const a = { kind: 'link' as const, url, title: linkForm.title.trim() || url };
    const r = client ? await client.addAttachment(issue.id, a) : null;
    if (r && !r.ok && !r.unsupported) { setToast('Could not add the link'); return; }
    setAttachments((x) => [...x, r && r.ok ? r.data : { ...a, id: lid('att'), created_by: ME }]);
    setLinkForm(null); log(`attached ${a.title}`);
  }
  async function removeAttachment(a: Attachment) {
    const r = client ? await client.removeAttachment(issue.id, a.id) : null;
    if (r && !r.ok && !r.unsupported) { setToast('Could not remove the attachment'); return; }
    setAttachments((x) => x.filter((y) => y.id !== a.id)); log(`removed attachment ${a.title}`);
  }

  async function postComment(body: string, parentId: string | null) {
    const r = client ? await client.addComment(issue.id, body, parentId) : null;
    if (r && !r.ok && !r.unsupported) { setToast('Could not post the comment'); return false; }
    setComments((c) => [...c, r && r.ok ? r.data : { id: lid('c'), body, author_id: ME, parent_comment_id: parentId, created_at: now(), reactions: [] }]);
    return true;
  }
  async function toggleReaction(c: Comment, emoji: string) {
    const cur = c.reactions?.find((x) => x.emoji === emoji);
    const on = !cur?.mine;
    const r = client ? await client.react(c.id, emoji, on) : null;
    if (r && !r.ok && !r.unsupported) { setToast('Could not react'); return; }
    setComments((cs) => cs.map((x) => {
      if (x.id !== c.id) return x;
      const list = (x.reactions ?? []).filter((y) => y.emoji !== emoji);
      const count = (cur?.count ?? 0) + (on ? 1 : -1);
      return { ...x, reactions: count > 0 ? [...list, { emoji, count, mine: on }] : list };
    }));
  }

  const roots = comments.filter((c) => !c.parent_comment_id);
  const replies = (id: string) => comments.filter((c) => c.parent_comment_id === id);
  const pr = progress(children);
  const due = dueState(issue.due_date, today);
  const pickTitle: Record<PickKind, string> = { status: 'Change status', priority: 'Set priority', assignee: 'Assign to', labels: 'Change labels', project: 'Move to project', cycle: 'Move to cycle', parent: 'Set parent issue', relation: `Add relation: ${pick?.relType ? REL_LABEL[pick.relType] : ''}` };
  const open = (kind: PickKind) => (e: React.MouseEvent<HTMLButtonElement>) => setPick({ kind, rect: e.currentTarget.getBoundingClientRect() });
  const assignee = who(issue.assignee_id);
  const project = meta.projects.find((p) => p.id === issue.project_id);
  const cycle = meta.cycles.find((c) => c.id === issue.cycle_id);
  const readOnly = !!issue.deleted_at;

  return (
    <div className='idp'>
      <main className='idp-main' aria-label={`Issue ${ident}`}>
        <header className='idp-head'>
          <nav aria-label='Breadcrumb' className='crumbs'><Link href='/'>Issues</Link><span className='sep' aria-hidden='true'>/</span>{parent && <><Link href={`/w/${slug}/issue/${identifierOf(parent)}`}>{identifierOf(parent)}</Link><span className='sep' aria-hidden='true'>/</span></>}<span className='id' aria-current='page'>{ident}</span></nav>
          <div className='idp-actions' role='toolbar' aria-label='Issue actions'>
            <button onClick={() => void copyLink()} aria-keyshortcuts='Meta+. Control+.' title='Copy issue URL (⌘.)'>Copy link</button>
            <button onClick={() => void copyBranch()} aria-keyshortcuts='Meta+Shift+. Control+Shift+.' title='Copy git branch name (⌘⇧.)'>Copy branch</button>
            {!readOnly && (issue.archived_at ? <button onClick={() => void lifecycle('unarchive')}>Unarchive</button> : <button onClick={() => void lifecycle('archive')}>Archive</button>)}
            {readOnly ? <button onClick={() => void lifecycle('restore')}>Restore</button> : <button className='danger' onClick={() => { if (window.confirm(`Delete ${ident}? You can restore it from the trash.`)) void lifecycle('delete'); }}>Delete</button>}
          </div>
        </header>
        {(issue.archived_at || issue.deleted_at) && <p className='idp-banner' role='status'>{issue.deleted_at ? 'This issue is in the trash. Restore it to edit.' : `Archived ${fmtDate(issue.archived_at as string)}.`}</p>}
        <label className='sr-only' htmlFor='idp-title'>Title</label>
        <input id='idp-title' className='idp-title' value={title} maxLength={255} readOnly={readOnly} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { setTitle(issue.title); e.currentTarget.blur(); } }} />

        <section className='idp-desc' aria-label='Description'>
          <div className='md-bar' role='toolbar' aria-label='Description editor'>
            <div className='md-tabs' role='tablist' aria-label='Editor mode'>
              <button role='tab' id='tab-write' aria-selected={tab === 'write'} aria-controls='desc-panel' onClick={() => setTab('write')}>Write</button>
              <button role='tab' id='tab-preview' aria-selected={tab === 'preview'} aria-controls='desc-panel' onClick={() => { saveDesc(); setTab('preview'); }}>Preview</button>
            </div>
            {tab === 'write' && !readOnly && <div className='md-tools'>
              <button aria-label='Bold' onMouseDown={(e) => e.preventDefault()} onClick={() => tool('b')}><b>B</b></button>
              <button aria-label='Italic' onMouseDown={(e) => e.preventDefault()} onClick={() => tool('i')}><i>I</i></button>
              <button aria-label='Inline code' onMouseDown={(e) => e.preventDefault()} onClick={() => tool('code')}>{'</>'}</button>
              <button aria-label='Link' onMouseDown={(e) => e.preventDefault()} onClick={() => tool('link')}>Link</button>
              <button aria-label='Bulleted list' onMouseDown={(e) => e.preventDefault()} onClick={() => tool('ul')}>• List</button>
              <button aria-label='Checklist' onMouseDown={(e) => e.preventDefault()} onClick={() => tool('task')}>☐ Task</button>
            </div>}
          </div>
          <div id='desc-panel' role='tabpanel' aria-labelledby={tab === 'write' ? 'tab-write' : 'tab-preview'}>
            {tab === 'write' && !readOnly
              ? <textarea ref={descRef} aria-label='Description (markdown)' className='md-input' value={desc} placeholder='Add description… (markdown)' onChange={(e) => setDesc(e.target.value)} onBlur={saveDesc} rows={8} />
              : <div className='md-view' onDoubleClick={() => !readOnly && setTab('write')}><Markdown source={desc} /></div>}
          </div>
        </section>

        <section className='idp-sec' aria-labelledby='h-sub'>
          <h2 id='h-sub'>Sub-issues {pr.total > 0 && <span className='count'>{pr.done}/{pr.total}</span>}</h2>
          <ul className='idp-rows'>{children.map((c) => <li key={c.id}><StatusIcon status={c.status} /><Link href={`/w/${slug}/issue/${identifierOf(c)}`}><span className='id'>{identifierOf(c)}</span> {c.title}</Link></li>)}</ul>
          {!readOnly && <form className='inline-add' onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const t = (new FormData(f).get('t') as string ?? '').trim(); if (t) { addSubIssue(t); f.reset(); } }}><label className='sr-only' htmlFor='sub-t'>New sub-issue title</label><input id='sub-t' name='t' placeholder='Add sub-issue…' maxLength={255} /><button type='submit'>Add</button></form>}
        </section>

        <section className='idp-sec' aria-labelledby='h-rel'>
          <h2 id='h-rel'>Relations</h2>
          <ul className='idp-rows'>{relations.map((r) => { const o = byId(r.related_issue_id); return <li key={r.id}><span className='rel-type'>{REL_LABEL[r.type]}</span>{o ? <Link href={`/w/${slug}/issue/${identifierOf(o)}`}><span className='id'>{identifierOf(o)}</span> {o.title}</Link> : <span>{r.related_issue_id}</span>}{!readOnly && <button className='x' aria-label={`Remove relation ${REL_LABEL[r.type]} ${o ? identifierOf(o) : ''}`} onClick={() => void removeRelation(r)}>×</button>}</li>; })}</ul>
          {!readOnly && <div className='rel-add'><button aria-haspopup='menu' aria-expanded={relMenu} onClick={() => setRelMenu((v) => !v)}>Add relation</button>{relMenu && <div role='menu' className='menu'>{(Object.keys(REL_LABEL) as Relation['type'][]).map((t) => <button role='menuitem' key={t} onClick={(e) => { setRelMenu(false); setPick({ kind: 'relation', relType: t, rect: e.currentTarget.getBoundingClientRect() }); }}>{REL_LABEL[t]}…</button>)}</div>}</div>}
        </section>

        <section className='idp-sec' aria-labelledby='h-att'>
          <h2 id='h-att'>Attachments</h2>
          <ul className='idp-rows'>{attachments.map((a) => <li key={a.id}><a href={safeHref(a.url) ?? '#'} target='_blank' rel='noopener noreferrer nofollow'>{a.title}</a>{!readOnly && <button className='x' aria-label={`Remove attachment ${a.title}`} onClick={() => void removeAttachment(a)}>×</button>}</li>)}</ul>
          {!readOnly && (linkForm ? <form className='inline-add' onSubmit={(e) => { e.preventDefault(); void addLink(); }}><label className='sr-only' htmlFor='att-url'>Link URL</label><input id='att-url' type='url' placeholder='https://…' value={linkForm.url} onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })} /><label className='sr-only' htmlFor='att-title'>Link title</label><input id='att-title' placeholder='Title (optional)' value={linkForm.title} onChange={(e) => setLinkForm({ ...linkForm, title: e.target.value })} /><button type='submit'>Attach</button><button type='button' onClick={() => setLinkForm(null)}>Cancel</button></form> : <button onClick={() => setLinkForm({ url: '', title: '' })}>Add link</button>)}
        </section>

        <section className='idp-sec' aria-labelledby='h-act'>
          <h2 id='h-act'>Activity</h2>
          <ol className='feed' aria-label='Activity'>
            {activity.map((a) => <li key={a.id} className='ev'><span className='who'>{who(a.actor)?.name ?? 'Someone'}</span> {a.action} <time dateTime={a.created_at}>{fmtTime(a.created_at)}</time></li>)}
          </ol>
          <ul className='threads' aria-label='Comments'>
            {roots.map((c) => <CommentItem key={c.id} c={c} replies={replies(c.id)} onReact={toggleReaction} onReply={(b) => postComment(b, c.id)} readOnly={readOnly} />)}
          </ul>
          {!readOnly && <Composer label='Leave a comment' onSubmit={(b) => postComment(b, null)} />}
        </section>
      </main>

      <aside className='idp-side' aria-label='Properties'>
        <dl>
          <dt>Status</dt><dd><button disabled={readOnly} onClick={open('status')} aria-haspopup='dialog'><StatusIcon status={issue.status} />{STATUS_LABEL[issue.status]}</button></dd>
          <dt>Priority</dt><dd><button disabled={readOnly} onClick={open('priority')} aria-haspopup='dialog'><PriorityIcon priority={issue.priority} />{PRIORITY_LABEL[issue.priority]}</button></dd>
          <dt>Assignee</dt><dd><button disabled={readOnly} onClick={open('assignee')} aria-haspopup='dialog'>{assignee && <Avatar initials={assignee.initials} hue={assignee.hue} />}{assignee?.name ?? 'Unassigned'}</button></dd>
          <dt>Labels</dt><dd><button disabled={readOnly} onClick={open('labels')} aria-haspopup='dialog'>{issue.label_ids.length ? issue.label_ids.map((l) => { const m = meta.labels.find((x) => x.id === l); return <span key={l} className={`chip ${m?.hue ?? ''}`}>{m?.name ?? l}</span>; }) : 'Add label'}</button></dd>
          <dt><label htmlFor='prop-est'>Estimate</label></dt><dd><select id='prop-est' disabled={readOnly} value={issue.estimate ?? ''} onChange={(e) => void update({ estimate: e.target.value === '' ? null : Number(e.target.value) }, e.target.value === '' ? 'removed the estimate' : `set estimate to ${e.target.value}`)}><option value=''>No estimate</option>{ESTIMATES.map((n) => <option key={n} value={n}>{n} pt{n === 1 ? '' : 's'}</option>)}</select></dd>
          <dt><label htmlFor='prop-due'>Due date</label></dt><dd><input id='prop-due' type='date' disabled={readOnly} className={`due-${due}`} value={issue.due_date ?? ''} onChange={(e) => { const v = e.target.value; if (v && !DUE_RE.test(v)) return; void update({ due_date: v || null }, v ? `set due date to ${v}` : 'removed the due date'); }} />{due === 'overdue' && <span className='due-flag'>Overdue</span>}</dd>
          <dt>Parent</dt><dd><button disabled={readOnly} onClick={open('parent')} aria-haspopup='dialog'>{parent ? `${identifierOf(parent)} ${parent.title}` : 'Set parent'}</button></dd>
          <dt>Project</dt><dd><button disabled={readOnly} onClick={open('project')} aria-haspopup='dialog'>{project?.name ?? 'Add to project'}</button></dd>
          <dt>Cycle</dt><dd><button disabled={readOnly} onClick={open('cycle')} aria-haspopup='dialog'>{cycle?.name ?? 'Add to cycle'}</button></dd>
          <dt>Branch</dt><dd><code className='branch'>{branch}</code></dd>
        </dl>
      </aside>
      {pick && <Picker title={pickTitle[pick.kind]} multi={pick.kind === 'labels'} anchor={pick.rect} options={options(pick.kind)} onPick={(id) => void onPick(id)} onClose={() => setPick(null)} />}
      {toast && <div className='toast' role='status'>{toast}</div>}
    </div>
  );
}

function CommentItem({ c, replies, onReact, onReply, readOnly }: { c: Comment; replies: Comment[]; onReact: (c: Comment, e: string) => void; onReply: (b: string) => Promise<boolean>; readOnly: boolean }) {
  const [replying, setReplying] = useState(false);
  const one = (x: Comment) => (
    <article className='cmt' aria-label={`Comment by ${who(x.author_id)?.name ?? 'Someone'}`}>
      <header><span className='who'>{who(x.author_id)?.name ?? 'Someone'}</span> <time dateTime={x.created_at}>{fmtTime(x.created_at)}</time></header>
      <Markdown source={x.body} empty='' />
      <div className='reacts' role='group' aria-label='Reactions'>
        {EMOJIS.map((e) => { const r = x.reactions?.find((y) => y.emoji === e); return (r || !readOnly) && <button key={e} className={r?.mine ? 'on' : ''} aria-pressed={!!r?.mine} aria-label={`React ${e}${r ? `, ${r.count}` : ''}`} disabled={readOnly} onClick={() => onReact(x, e)}>{e}{r && <span>{r.count}</span>}</button>; })}
      </div>
    </article>
  );
  return (
    <li>
      {one(c)}
      {replies.length > 0 && <ul className='replies'>{replies.map((r) => <li key={r.id}>{one(r)}</li>)}</ul>}
      {!readOnly && (replying ? <Composer label='Reply' autoFocus onSubmit={async (b) => { const ok = await onReply(b); if (ok) setReplying(false); return ok; }} onCancel={() => setReplying(false)} /> : <button className='link-btn' onClick={() => setReplying(true)}>Reply</button>)}
    </li>
  );
}

function Composer({ label, onSubmit, onCancel, autoFocus }: { label: string; onSubmit: (b: string) => Promise<boolean>; onCancel?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const at = activeMention(text, caret);
  const list = at ? suggest(MENTION_USERS, at.query) : [];
  const idx = Math.min(sel, Math.max(list.length - 1, 0));
  const listId = useMemo(() => lid('ml'), []);
  function choose(u: MentionUser) {
    if (!at) return;
    const r = insertMention(text, at, u);
    setText(r.text); setCaret(r.caret);
    requestAnimationFrame(() => { ref.current?.setSelectionRange(r.caret, r.caret); ref.current?.focus(); });
  }
  async function submit() { const b = text.trim(); if (!b) return; if (await onSubmit(b)) { setText(''); setCaret(0); } }
  return (
    <div className='composer'>
      <textarea ref={ref} autoFocus={autoFocus} aria-label={label} placeholder={`${label}… (@ to mention, ⌘↵ to send)`} rows={3} value={text}
        role='combobox' aria-expanded={list.length > 0} aria-controls={listId} aria-autocomplete='list' aria-activedescendant={list[idx] ? `${listId}-${list[idx].id}` : undefined}
        onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setSel(0); }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (list.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(idx + 1, list.length - 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(idx - 1, 0)); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const u = list[idx]; if (u) choose(u); return; }
            if (e.key === 'Escape') { e.preventDefault(); setCaret(-1); return; }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); }
          if (e.key === 'Escape' && onCancel) onCancel();
        }} />
      {list.length > 0 && <ul id={listId} role='listbox' aria-label='Mention a teammate' className='mention-list'>{list.map((u, k) => <li key={u.id} id={`${listId}-${u.id}`} role='option' aria-selected={k === idx} onMouseDown={(e) => { e.preventDefault(); choose(u); }}>{u.name} <span className='dim'>@{u.handle}</span></li>)}</ul>}
      <div className='composer-actions'>{onCancel && <button onClick={onCancel}>Cancel</button>}<button className='primary' disabled={!text.trim()} onClick={() => void submit()}>{label === 'Reply' ? 'Reply' : 'Comment'}</button></div>
    </div>
  );
}

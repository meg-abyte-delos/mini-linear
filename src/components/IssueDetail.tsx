'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { USERS, STATUSES, STATUS_LABEL, PRIORITY_LABEL, fmtDate, type Issue, type Meta, type Status } from '@/lib/issues';
import { Avatar, PriorityIcon, StatusIcon } from '@/components/icons';
import { Combobox, type ComboOption } from '@/components/ui/Combobox';
import { Markdown } from '@/components/Markdown';
import { RichEditor } from '@/components/RichEditor';
import { useIssueRealtime } from '@/lib/detail/use-issue-realtime';
import { ConfirmDialog, Tooltip, type MenuEntry } from '@/components/ui';
import { createIssue, patchIssue } from '@/lib/api-client';
import { detailApi, reactedBy, type Attachment, type Comment, type Relation, type ActivityItem } from '@/lib/detail/api';
import { statusOf } from '@/lib/detail/activity-status';
import { branchName, dueState, identifierOf, issueUrl, progress, DUE_RE } from '@/lib/detail/issue-meta';
import { activeMention, insertMention, suggest, type MentionUser } from '@/lib/detail/mentions';
import { safeHref } from '@/lib/detail/markdown';
import { EMPTY_PEOPLE, fetchNlPeople, type NlPeople } from '@/lib/nl-people';
import { MOCK_PEOPLE, findPerson, peopleFromNl, type Person } from '@/lib/people';
import { IssueHeaderBar, type HeaderNav } from '@/components/IssueHeaderBar';
import { PropIcon } from '@/components/PropIcons';
import { PresenceStack } from '@/components/PresenceStack';
import { usePresence } from '@/lib/presence/use-presence';

export type DetailIssue = Issue & { estimate?: number | null; due_date?: string | null; archived_at?: string | null; branch_name?: string; url?: string };
type PickKind = 'status' | 'priority' | 'assignee' | 'labels' | 'project' | 'cycle' | 'parent' | 'relation';
const REL_ORDER: Relation['type'][] = ['blocks', 'blocked_by', 'related', 'duplicate'];
const REL_LABEL: Record<Relation['type'], string> = { blocks: 'Blocks', blocked_by: 'Blocked by', related: 'Related', duplicate: 'Duplicate of' };
const ESTIMATES = [0, 1, 2, 3, 5, 8, 13];
const EMOJIS = ['👍', '🎉', '❤️', '👀'];
const mentionUsers = (people: readonly Person[]): MentionUser[] => people.map((u) => ({ id: u.id, name: u.name, handle: u.name.split(' ')[0]?.toLowerCase() ?? u.id }));
// Workspace directory for names, avatars and mentions: members in API mode, the USERS fixtures in mock mode.
const PeopleCtx = createContext<readonly Person[]>(MOCK_PEOPLE);
const MOCK_ME = USERS[0].id;
const MeCtx = createContext<string>(MOCK_ME);
let seq = 0;
const lid = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;
const now = () => new Date().toISOString();
const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

export function IssueDetail({ slug, initial, all, meta, api, today, viewer = null, teamId }: { teamId?: string; slug: string; initial: DetailIssue; all: DetailIssue[]; meta: Meta; api: boolean; today: string; viewer?: { userId: string | null; role: string } | null }) {
  const [nlPeople, setNlPeople] = useState<NlPeople>(EMPTY_PEOPLE);
  useEffect(() => {
    if (!api) return;
    let live = true;
    void fetchNlPeople(slug).then((p) => { if (live) setNlPeople(p); });
    return () => { live = false; };
  }, [api, slug]);
  const people = useMemo<readonly Person[]>(() => (api ? peopleFromNl(nlPeople) : MOCK_PEOPLE), [api, nlPeople]);
  const ME = api ? (viewer?.userId ?? nlPeople.me ?? '') : MOCK_ME;
  return <PeopleCtx.Provider value={people}><MeCtx.Provider value={ME}><IssueDetailBody slug={slug} initial={initial} all={all} meta={meta} api={api} today={today} viewer={viewer} teamId={teamId} people={people} ME={ME} /></MeCtx.Provider></PeopleCtx.Provider>;
}

function IssueDetailBody({ slug, initial, all, meta, api, today, viewer = null, teamId , people, ME}: { people: readonly Person[]; ME: string; teamId?: string; slug: string; initial: DetailIssue; all: DetailIssue[]; meta: Meta; api: boolean; today: string; viewer?: { userId: string | null; role: string } | null }) {
  const who = (id: string | null | undefined) => findPerson(people, id);
  const [issue, setIssue] = useState<DetailIssue>(initial);
  const [others, setOthers] = useState<DetailIssue[]>(all.filter((i) => i.id !== initial.id));
  const [title, setTitle] = useState(initial.title);
  const viewers = usePresence(slug, initial.id, viewer?.userId, api);
  const [pick, setPick] = useState<{ kind: PickKind; el: HTMLElement | null; relType?: Relation['type'] } | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([{ id: 'a0', actor_id: initial.assignee_id as string | null, action: 'created the issue', created_at: initial.created_at }]);
  const [toast, setToast] = useState<string | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const relBtn = useRef<HTMLButtonElement>(null);
  const pickAnchor = useRef<HTMLElement | null>(null);
  const lastPick = useRef(pick);
  const [linkForm, setLinkForm] = useState<{ url: string; title: string } | null>(null);
  const [relMenu, setRelMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
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
    void client.subscription(issue.id).then((r) => r.ok && setSubscribed(!!r.data.subscribed));
  }, [client, issue.id]);

  // Realtime: other tabs/users editing this issue, its comments, parent or sub-issues show up without a reload.
  const issueRef = useRef(issue); issueRef.current = issue;
  const [gone, setGone] = useState(false);
  const [rtOffline, setRtOffline] = useState(false);
  useIssueRealtime(slug, api, initial.id, version, {
    onSelf: (row) => {
      const cur = issueRef.current;
      version.current = row.version;
      setIssue({ ...cur, ...row });
      setTitle((t) => (t === cur.title ? row.title : t)); // a title being typed is not overwritten
    },
    onSelfGone: () => setGone(true),
    onOther: (row) => setOthers((o) => (o.some((x) => x.id === row.id) ? o.map((x) => (x.id === row.id && row.version >= x.version ? { ...x, ...row } : x)) : [...o, row])),
    onOtherGone: (id) => setOthers((o) => o.filter((x) => x.id !== id)),
    onActivity: () => {
      if (!client) return;
      const id = initial.id;
      void client.comments(id).then((r) => r.ok && setComments(r.data.items));
      void client.activity(id).then((r) => r.ok && r.data.items.length && setActivity(r.data.items));
      void client.relations(id).then((r) => r.ok && setRelations(r.data.items));
    },
    onState: (s) => setRtOffline(s === 'offline'),
  });
  useEffect(() => { document.documentElement.dataset.ready = '1'; }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t); }, [toast]);

  const log = (action: string) => setActivity((a) => [...a, { id: lid('a'), actor_id: ME, action, summary: action, created_at: now() }]);

  async function update(patch: Partial<DetailIssue>, label: string) {
    const prev = issue;
    const next = { ...issue, ...patch, version: issue.version + 1 };
    setIssue(next);
    if (!api) { log(label); return; }
    // API mode: show the change at once, then swap it for the server's entry once the PATCH has landed (the server wording names the old and new values).
    const optId = lid('a');
    setActivity((a) => [...a, { id: optId, actor_id: ME, action: label, summary: label, created_at: now() }]);
    const r = await patchIssue(slug, prev, version.current, patch as Record<string, unknown>);
    if (r.issue) { version.current = r.issue.version; if (r.kind !== 'ok') setIssue(r.issue); }
    if (r.kind === 'error' && !r.issue) { setIssue(prev); setTitle(prev.title); } // offline / timeout: roll the optimistic edit back
    if (r.kind === 'conflict') setToast('Issue modified elsewhere. Reloaded the latest version.');
    else if (r.kind === 'error') setToast('Could not save the change.');
    if (r.kind !== 'ok') { setActivity((a) => a.filter((x) => x.id !== optId)); }
    if (client) { const f = await client.activity(issue.id); if (f.ok && f.data.items.length) setActivity(f.data.items); }
  }

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); setToast(`Copied ${what}`); } catch { setToast(`Copy failed: ${text}`); }
  }
  const copyLink = () => copy(issue.url || issueUrl(window.location.origin, slug, ident), 'issue URL');
  const copyBranch = () => copy(branch, 'branch name');

  async function toggleSubscribe() {
    const on = !subscribed;
    const r = client ? await client.subscribe(issue.id, on) : null;
    if (r && !r.ok && !r.unsupported) { setToast(`Could not ${on ? 'subscribe to' : 'unsubscribe from'} ${ident}`); return; }
    if (r && !r.ok && r.unsupported) { setToast('Subscriptions are not available here'); return; } // nothing was saved: no success toast
    setSubscribed(on);
    setToast(on ? `Subscribed to ${ident}` : `Unsubscribed from ${ident}`);
  }
  async function makeCopy() {
    const team = (issue as { team_id?: string }).team_id ?? teamId;
    if (!api || !team) { setToast('Cannot copy the issue: no team selected'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const row = await createIssue(slug, team, `Copy of ${issue.title}`.slice(0, 255));
      if (!row) { setToast('Could not copy the issue'); return; }
      const carry: Record<string, unknown> = {};
      if (issue.description) carry.description = issue.description;
      if (issue.priority) carry.priority = issue.priority;
      if (issue.assignee_id) carry.assignee_id = issue.assignee_id;
      if (issue.label_ids.length) carry.label_ids = issue.label_ids;
      if (issue.project_id) carry.project_id = issue.project_id;
      if (issue.cycle_id) carry.cycle_id = issue.cycle_id;
      if (issue.parent_id) carry.parent_id = issue.parent_id;
      if (issue.estimate != null) carry.estimate = issue.estimate;
      if (issue.due_date) carry.due_date = issue.due_date;
      if (Object.keys(carry).length) { const r = await patchIssue(slug, row, row.version, carry); if (r.kind !== 'ok') setToast(`Copied as ${identifierOf(row)}, but some fields could not be carried over`); }
      log(`copied to ${identifierOf(row)}`);
      router.push(`/w/${slug}/issue/${identifierOf(row)}`);
    } finally { setBusy(false); }
  }

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
  const saveDesc = (md: string) => { if (md !== issue.description) void update({ description: md }, 'updated the description'); };

  function options(kind: PickKind): ComboOption[] {
    switch (kind) {
      case 'status': return STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s], checked: issue.status === s, lead: <StatusIcon status={s} /> }));
      case 'priority': return PRIORITY_LABEL.map((l, p) => ({ id: String(p), label: l, checked: issue.priority === p, lead: <PriorityIcon priority={p as Issue['priority']} /> }));
      case 'assignee': return [{ id: '', label: 'Unassigned', checked: !issue.assignee_id }, ...people.map((u) => ({ id: u.id, label: u.name, checked: issue.assignee_id === u.id, lead: <Avatar initials={u.initials} hue={u.hue} /> }))];
      case 'labels': return meta.labels.map((l) => ({ id: l.id, label: l.name, checked: issue.label_ids.includes(l.id) }));
      case 'project': return [{ id: '', label: 'No project', checked: !issue.project_id }, ...meta.projects.map((p) => ({ id: p.id, label: p.name, checked: issue.project_id === p.id }))];
      case 'cycle': return [{ id: '', label: 'No cycle', checked: !issue.cycle_id }, ...meta.cycles.map((c) => ({ id: c.id, label: c.name, checked: issue.cycle_id === c.id }))];
      case 'parent': return [{ id: '', label: 'No parent', checked: !issue.parent_id }, ...others.filter((o) => o.parent_id !== issue.id && !o.deleted_at).map((o) => ({ id: o.id, label: `${identifierOf(o)} ${o.title}`, checked: issue.parent_id === o.id }))];
      case 'relation': return others.filter((o) => !o.deleted_at && !relations.some((r) => r.related_issue_id === o.id)).map((o) => ({ id: o.id, label: `${identifierOf(o)} ${o.title}`, lead: <StatusIcon status={o.status} /> }));
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

  async function addSubIssue(t: string): Promise<boolean> {
    if (api && !teamId) { setToast('Cannot create a sub-issue: no team selected'); return false; }
    if (api && teamId) {
      if (subBusy) return false;
      setSubBusy(true);
      try {
        const row = await createIssue(slug, teamId, t, undefined, issue.id);
        if (!row) { setToast('Could not create the sub-issue'); return false; }
        setOthers((o) => [...o, { ...row, parent_id: issue.id } as DetailIssue]);
        log(`added sub-issue ${identifierOf(row)}`);
        return true;
      } finally { setSubBusy(false); }
    }
    const n = others.length + 2000;
    const child: DetailIssue = { ...issue, id: `${ident.split('-')[0] ?? 'DEL'}-${n}`, identifier: undefined, title: t, description: '', status: 'todo', parent_id: issue.id, label_ids: [], version: 1, created_at: now(), deleted_at: null, archived_at: null };
    setOthers((o) => [...o, child]);
    log(`added sub-issue ${child.id}`);
    return true;
  }

  async function lifecycle(action: 'archive' | 'unarchive' | 'delete' | 'restore') {
    const r = client ? await (action === 'delete' ? client.remove(issue.id, version.current) : action === 'restore' ? client.restore(issue.id) : client.archive(issue.id, action === 'archive')) : null;
    if (r && !r.ok && !r.unsupported) { setToast(`Could not ${action} the issue`); return; }
    // The server bumps the version on every lifecycle change: keep the If-Match token in step (restore returns the row).
    if (r && r.ok) { const v = (r.data as { version?: number } | null)?.version; version.current = typeof v === 'number' ? v : version.current + 1; }
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
  async function editComment(c: Comment, body: string) {
    const r = client ? await client.editComment(c.id, body, c.version ?? 1) : null;
    if (r && !r.ok && !r.unsupported) { setToast(r.status === 412 ? 'Comment changed elsewhere. Reload to edit.' : r.status === 403 ? 'Only the author can edit this comment' : 'Could not edit the comment'); return false; }
    setComments((cs) => cs.map((x) => (x.id === c.id ? (r && r.ok ? { ...x, ...r.data, reactions: x.reactions } : { ...x, body, edited_at: now(), version: (x.version ?? 1) + 1 }) : x)));
    if (!client) log('edited a comment');
    return true;
  }
  async function removeComment(c: Comment) {
    if (!window.confirm('Delete this comment? Replies are deleted with it.')) return;
    const r = client ? await client.deleteComment(c.id, c.version ?? 1) : null;
    if (r && !r.ok && !r.unsupported) { setToast(r.status === 403 ? 'Only the author or an admin can delete this comment' : 'Could not delete the comment'); return; }
    setComments((cs) => cs.filter((x) => x.id !== c.id && x.parent_comment_id !== c.id));
    if (!client) log('deleted a comment');
    else void client.activity(issue.id).then((a) => a.ok && a.data.items.length && setActivity(a.data.items));
  }
  async function toggleReaction(c: Comment, emoji: string) {
    const cur = c.reactions?.find((x) => x.emoji === emoji);
    const on = !reactedBy(cur, ME);
    const r = client ? await client.react(c.id, emoji, on) : null;
    if (r && !r.ok && !r.unsupported) { setToast('Could not react'); return; }
    setComments((cs) => cs.map((x) => {
      if (x.id !== c.id) return x;
      const list = (x.reactions ?? []).filter((y) => y.emoji !== emoji);
      const count = (cur?.count ?? 0) + (on ? 1 : -1);
      const ids = on ? [...(cur?.user_ids ?? []), ME] : (cur?.user_ids ?? []).filter((u) => u !== ME);
      return { ...x, reactions: count > 0 ? [...list, { emoji, count, user_ids: ids }] : list };
    }));
  }

  const roots = comments.filter((c) => !c.parent_comment_id);
  const replies = (id: string) => comments.filter((c) => c.parent_comment_id === id);
  // One chronological timeline: thread roots interleave with change events (comment events are shown by the comment itself).
  const timeline = [
    ...activity.filter((a) => !/^(commented|edited a comment)$/.test(a.summary ?? a.action)).map((at) => ({ kind: 'event' as const, at, ts: Date.parse(at.created_at) || 0 })),
    ...roots.map((c) => ({ kind: 'comment' as const, c, ts: Date.parse(c.created_at) || 0 })),
  ].sort((a, b) => a.ts - b.ts);
  const pr = progress(children);
  const due = dueState(issue.due_date, today);
  // The Combobox stays mounted so it can animate out; it keeps the last kind while closed.
  if (pick) lastPick.current = pick;
  const shown = pick ?? lastPick.current ?? { kind: 'status' as PickKind, el: null };
  const pickTitle: Record<PickKind, string> = { status: 'Change status', priority: 'Set priority', assignee: 'Assign to', labels: 'Change labels', project: 'Move to project', cycle: 'Move to cycle', parent: 'Set parent issue', relation: `Add relation: ${lastPick.current?.relType ? REL_LABEL[lastPick.current.relType] : ''}` };
  pickAnchor.current = pick?.el ?? null;
  const open = (kind: PickKind) => (e: React.MouseEvent<HTMLButtonElement>) => setPick({ kind, el: e.currentTarget });
  const assignee = who(issue.assignee_id);
  const project = meta.projects.find((p) => p.id === issue.project_id);
  const cycle = meta.cycles.find((c) => c.id === issue.cycle_id);
  const readOnly = !!issue.deleted_at;
  // Prev/next: live issues of the workspace in identifier order (the list's default sort).
  const nav = useMemo<HeaderNav | null>(() => {
    const num = (i: DetailIssue) => Number(identifierOf(i).split('-').pop()) || 0;
    const seq = [...all.filter((i) => !i.deleted_at && i.id !== issue.id), issue].sort((a, b) => num(a) - num(b));
    const at = seq.findIndex((i) => i.id === issue.id);
    if (at < 0 || seq.length < 2) return null;
    const href = (i: DetailIssue | undefined) => (i ? `/w/${slug}/issue/${identifierOf(i)}` : null);
    return { index: at, total: seq.length, prev: href(seq[at - 1]), next: href(seq[at + 1]) };
  }, [all, issue, slug]);

  const mi = (d: string) => (<svg width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'><path d={d} /></svg>);
  const menuEntries: MenuEntry[] = [
    { id: 'copy-id', label: 'Copy ID', icon: mi('M5.5 2.5h7v8h-7zM3.5 5.5v8h7'), onSelect: () => void copy(ident, 'issue ID') },
    { id: 'copy-title', label: 'Copy title', icon: mi('M3 4V2.8h10V4M8 2.8v10.4M6 13.2h4'), onSelect: () => void copy(issue.title, 'issue title') },
    { id: 'copy-link', label: 'Copy link', icon: mi('M6.8 9.2a2.5 2.5 0 0 0 3.5 0l2.2-2.2a2.5 2.5 0 0 0-3.5-3.5l-.6.6M9.2 6.8a2.5 2.5 0 0 0-3.5 0L3.5 9a2.5 2.5 0 0 0 3.5 3.5l.6-.6'), shortcut: ['⌘', '.'], onSelect: () => void copyLink() },
    { id: 'copy-branch', label: 'Copy branch name', icon: mi('M4.5 2.5v9M4.5 11.5a1.5 1.5 0 1 0 0 .01M9.5 4a1.5 1.5 0 1 0 0 .01M9.5 5.5c0 2.5-5 2-5 4.5'), shortcut: ['⌘', '⇧', '.'], onSelect: () => void copyBranch() },
    ...(readOnly ? [] : [
      { type: 'separator' } as const,
      { id: 'subscribe', label: subscribed ? 'Unsubscribe' : 'Subscribe', icon: mi('M8 2.5a3.5 3.5 0 0 0-3.5 3.5c0 3-1.5 4-1.5 4h10s-1.5-1-1.5-4A3.5 3.5 0 0 0 8 2.5ZM6.8 12.5a1.3 1.3 0 0 0 2.4 0'), onSelect: () => void toggleSubscribe() },
      { id: 'move', label: 'Move to project…', icon: mi('M2.5 4.5h3.2l1.3 1.5h6.5v6.5h-11zM8 8.2h3M9.8 7l1.2 1.2L9.8 9.4'), onSelect: () => { setPick({ kind: 'project', el: moreRef.current }); } },
      { id: 'copy', label: 'Make a copy', icon: mi('M5.5 5.5h7v7h-7zM3.5 10.5v-8h8'), disabled: busy, onSelect: () => void makeCopy() },
      { id: 'archive', label: issue.archived_at ? 'Unarchive' : 'Archive', icon: mi('M2.5 3.5h11v3h-11zM3.5 6.5v6h9v-6M6.5 9h3'), onSelect: () => void lifecycle(issue.archived_at ? 'unarchive' : 'archive') },
      { type: 'separator' } as const,
      { id: 'delete', label: 'Delete', icon: mi('M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5M7 7v4M9 7v4'), destructive: true, onSelect: () => setConfirmDelete(true) },
    ]),
  ];
  const dueLabel = issue.due_date ? new Date(`${issue.due_date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Set due date';

  return (
    <div className='idp'>
      <main className='idp-main' aria-label={`Issue ${ident}`}>
        <header className='idp-head'>
          <nav aria-label='Breadcrumb' className='crumbs'><Link href='/'>Issues</Link><span className='sep' aria-hidden='true'>/</span>{parent && <><Link href={`/w/${slug}/issue/${identifierOf(parent)}`}>{identifierOf(parent)}</Link><span className='sep' aria-hidden='true'>/</span></>}<span className='id' aria-current='page'>{ident}</span></nav>
          <button className='idh-status' disabled={readOnly} onClick={open('status')} aria-haspopup='dialog' aria-label={`Status: ${STATUS_LABEL[issue.status]}. Change status`}><StatusIcon status={issue.status} /><span>{STATUS_LABEL[issue.status]}</span></button>
          <PresenceStack presence={viewers} size='md' />
          <IssueHeaderBar ident={ident} nav={nav} readOnly={readOnly} entries={menuEntries} moreRef={moreRef} onRestore={() => void lifecycle('restore')} />
        </header>
        {(issue.archived_at || issue.deleted_at) && <p className='idp-banner' role='status'>{issue.deleted_at ? 'This issue is in the trash. Restore it to edit.' : `Archived ${fmtDate(issue.archived_at as string)}.`}</p>}
        {parent && <Link className='parent-crumb' href={`/w/${slug}/issue/${identifierOf(parent)}`}><span className='id'>{identifierOf(parent)}</span> {parent.title}</Link>}
        <label className='sr-only' htmlFor='idp-title'>Title</label>
        <input id='idp-title' className='idp-title' value={title} maxLength={255} readOnly={readOnly} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { setTitle(issue.title); e.currentTarget.blur(); } }} />

        <section className='idp-desc' aria-label='Description'>
          <RichEditor value={issue.description} readOnly={readOnly} onCommit={saveDesc} />
        </section>

        <section className='idp-sec' aria-labelledby='h-sub'>
          <h2 id='h-sub'>Sub-issues {pr.total > 0 && <><span className='count'>{pr.done}/{pr.total}</span><span className='sub-bar' role='img' aria-label={`${pr.done} of ${pr.total} sub-issues done`}><span style={{ width: `${Math.round((pr.done / pr.total) * 100)}%` }} /></span></>}
            {!readOnly && <button className='sec-add' aria-label='Add sub-issue' onClick={() => setAdding(true)}>+</button>}</h2>
          {children.length > 0 && <ul className='idp-rows'>{children.map((c) => <li key={c.id} className={c.status === 'done' ? 'is-done' : undefined}><Link className='row-link' href={`/w/${slug}/issue/${identifierOf(c)}`}><StatusIcon status={c.status} /><span className='id'>{identifierOf(c)}</span><span className='t'>{c.title}</span>{(() => { const u = who(c.assignee_id); return u ? <Avatar initials={u.initials} hue={u.hue} /> : null; })()}</Link></li>)}</ul>}
          {!readOnly && adding && <form className='inline-add' onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const t = (new FormData(f).get('t') as string ?? '').trim(); if (t && !subBusy) { void addSubIssue(t).then((ok) => { if (ok) f.reset(); }); } }}><label className='sr-only' htmlFor='sub-t'>New sub-issue title</label><input id='sub-t' name='t' autoFocus readOnly={subBusy} aria-busy={subBusy} placeholder='Sub-issue title, Enter to create' maxLength={255} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); } }} /><button type='submit' disabled={subBusy}>Add</button></form>}
          {!readOnly && !adding && children.length > 0 && <button className='add-row' onClick={() => setAdding(true)}>+ Add sub-issue</button>}
        </section>

        <section className='idp-sec' aria-labelledby='h-rel'>
          <h2 id='h-rel'>Relations
            {!readOnly && <span className='rel-add'><button ref={relBtn} className='sec-add' aria-label='Add relation' aria-haspopup='menu' aria-expanded={relMenu} onClick={() => setRelMenu((v) => !v)}>+</button>{relMenu && <div role='menu' className='menu' onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRelMenu(false); relBtn.current?.focus(); } }}>{REL_ORDER.map((t) => <button role='menuitem' key={t} onClick={() => { setRelMenu(false); setPick({ kind: 'relation', relType: t, el: relBtn.current }); }}>{REL_LABEL[t]}…</button>)}</div>}</span>}
          </h2>
          {REL_ORDER.map((t) => { const rs = relations.filter((r) => r.type === t); if (!rs.length) return null; return (
            <div key={t} className='rel-group'><div className='rel-type' id={`rg-${t}`}>{REL_LABEL[t]}</div>
              <ul className='idp-rows' aria-labelledby={`rg-${t}`}>{rs.map((r) => { const o = byId(r.related_issue_id); const open = t === 'blocked_by' && !!o && o.status !== 'done'; const u = who(o?.assignee_id); return (
                <li key={r.id} className={o?.status === 'done' ? 'is-done' : undefined}>
                  {o ? <Link className='row-link' href={`/w/${slug}/issue/${identifierOf(o)}`}><StatusIcon status={o.status} /><span className='id'>{identifierOf(o)}</span><span className='t'>{o.title}</span>{open && <span className='blocked-flag' title='Still blocking'>Blocked</span>}{u && <Avatar initials={u.initials} hue={u.hue} />}</Link> : <span className='row-link'>{r.related_issue_id}</span>}
                  {!readOnly && <button className='x' aria-label={`Remove relation ${REL_LABEL[r.type]} ${o ? identifierOf(o) : ''}`} onClick={() => void removeRelation(r)}>×</button>}
                </li>); })}</ul></div>); })}
        </section>

        <section className='idp-sec' aria-labelledby='h-att'>
          <h2 id='h-att'>Attachments</h2>
          <ul className='idp-rows'>{attachments.map((a) => <li key={a.id}><a href={safeHref(a.url) ?? '#'} target='_blank' rel='noopener noreferrer nofollow'>{a.title}</a>{!readOnly && <button className='x' aria-label={`Remove attachment ${a.title}`} onClick={() => void removeAttachment(a)}>×</button>}</li>)}</ul>
          {!readOnly && (linkForm ? <form className='inline-add' onSubmit={(e) => { e.preventDefault(); void addLink(); }}><label className='sr-only' htmlFor='att-url'>Link URL</label><input id='att-url' type='url' placeholder='https://…' value={linkForm.url} onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })} /><label className='sr-only' htmlFor='att-title'>Link title</label><input id='att-title' placeholder='Title (optional)' value={linkForm.title} onChange={(e) => setLinkForm({ ...linkForm, title: e.target.value })} /><button type='submit'>Attach</button><button type='button' onClick={() => setLinkForm(null)}>Cancel</button></form> : <button onClick={() => setLinkForm({ url: '', title: '' })}>Add link</button>)}
        </section>

        <section className='idp-sec' aria-labelledby='h-act'>
          <h2 id='h-act'>Activity</h2>
          <ol className='feed' aria-label='Activity'>
            {timeline.map((t) => t.kind === 'event'
              ? <ActivityEvent key={t.at.id} at={t.at} actor={who(t.at.actor_id)} />
              : <li key={t.c.id} className='tl-cmt'><CommentItem c={t.c} replies={replies(t.c.id)} onReact={toggleReaction} onReply={(b) => postComment(b, t.c.id)} onEdit={editComment} onDelete={removeComment} canEdit={(x) => (client ? !!viewer?.userId && x.author_id === viewer.userId : x.author_id === ME)} canDelete={(x) => (client ? !!viewer?.userId && (x.author_id === viewer.userId || viewer.role === 'owner' || viewer.role === 'admin') : x.author_id === ME)} readOnly={readOnly} /></li>)}
          </ol>
          {!readOnly && <Composer label='Leave a comment' onSubmit={(b) => postComment(b, null)} />}
        </section>
      </main>

      <aside className='idp-side' aria-label='Properties'>
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
          <dt><label htmlFor='prop-est'>Estimate</label></dt><dd className='prop-native'><span className='prop-pill' aria-hidden='true'><PropIcon name='estimate' /><span className={issue.estimate == null ? 'prop-empty' : undefined}>{issue.estimate == null ? 'Set estimate' : `${issue.estimate} pt${issue.estimate === 1 ? '' : 's'}`}</span></span><select id='prop-est' disabled={readOnly} value={issue.estimate ?? ''} onChange={(e) => void update({ estimate: e.target.value === '' ? null : Number(e.target.value) }, e.target.value === '' ? 'removed the estimate' : `set estimate to ${e.target.value}`)}><option value=''>No estimate</option>{ESTIMATES.map((n) => <option key={n} value={n}>{n} pt{n === 1 ? '' : 's'}</option>)}</select></dd>
          <dt><label htmlFor='prop-due'>Due date</label></dt><dd className='prop-native'><span className={`prop-pill due-${due}`} aria-hidden='true'><PropIcon name='due' /><span className={issue.due_date ? undefined : 'prop-empty'}>{dueLabel}</span>{due === 'overdue' && <span className='due-flag'>Overdue</span>}</span><input id='prop-due' type='date' disabled={readOnly} value={issue.due_date ?? ''} onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* not supported */ } }} onChange={(e) => { const v = e.target.value; if (v && !DUE_RE.test(v)) return; void update({ due_date: v || null }, v ? `set due date to ${v}` : 'removed the due date'); }} /></dd>
          <dt>Cycle</dt><dd><button disabled={readOnly} onClick={open('cycle')} aria-haspopup='dialog'><PropIcon name='cycle' /><span className={cycle ? 'prop-trunc' : 'prop-empty'}>{cycle?.name ?? 'Add to cycle'}</span></button></dd>
          </dl>
        </section>
        <section className='side-group' aria-labelledby='sg-org'>
          <h3 id='sg-org' className='side-h'>Organization</h3>
          <dl>
          <dt>Parent</dt><dd><button disabled={readOnly} onClick={open('parent')} aria-haspopup='dialog'><PropIcon name='parent' /><span className={parent ? 'prop-trunc' : 'prop-empty'}>{parent ? `${identifierOf(parent)} ${parent.title}` : 'Set parent'}</span></button></dd>
          <dt>Project</dt><dd><button disabled={readOnly} onClick={open('project')} aria-haspopup='dialog'><PropIcon name='project' /><span className={project ? 'prop-trunc' : 'prop-empty'}>{project?.name ?? 'Add to project'}</span></button></dd>
          </dl>
        </section>
        <section className='side-group' aria-labelledby='sg-git'>
          <h3 id='sg-git' className='side-h'>Git</h3>
          <dl>
          <dt>Branch</dt><dd><Tooltip label={branch}><button className='branch-btn' onClick={() => void copyBranch()} aria-label={`Copy branch name ${branch}`}><PropIcon name='branch' /><code className='branch'>{branch}</code><span className='branch-copy'><PropIcon name='copy' /></span></button></Tooltip></dd>
          </dl>
        </section>
      </aside>
      <Combobox open={!!pick} anchorRef={pickAnchor} onClose={() => setPick(null)} label={pickTitle[shown.kind]} multi={shown.kind === 'labels'} options={options(shown.kind)} onPick={(id) => void onPick(id)} />
      <ConfirmDialog open={confirmDelete} title={`Delete ${ident}?`} confirmLabel='Delete' destructive onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); void lifecycle('delete'); }}>
        <p>{issue.title}</p><p>The issue moves to the trash. You can restore it from there.</p>
      </ConfirmDialog>
      {gone ? <div className='toast' role='alert'>This issue was deleted elsewhere. <Link href='/'>Back to issues</Link></div> : toast ? <div className='toast' role='status'>{toast}</div> : rtOffline ? <div className='toast' role='status'>Offline. Reconnecting…</div> : null}
    </div>
  );
}

function ActivityEvent({ at, actor }: { at: ActivityItem; actor: Person | undefined }) {
  const st = statusOf(at);
  return (
    <li className='ev'>
      <span className='ev-lead' aria-hidden='true'>{actor ? <Avatar initials={actor.initials} hue={actor.hue} /> : <span className='dot' />}</span>
      <span className='ev-text'><span className='who'>{actor?.name ?? 'Someone'}</span> {st && <span className='ev-status'><StatusIcon status={st} /></span>}{at.summary ?? at.action} <time dateTime={at.created_at}>{fmtTime(at.created_at)}</time></span>
    </li>
  );
}

function CommentItem({ c, replies, onReact, onReply, onEdit, onDelete, canEdit, canDelete, readOnly }: { c: Comment; replies: Comment[]; onReact: (c: Comment, e: string) => void; onReply: (b: string) => Promise<boolean>; onEdit: (c: Comment, b: string) => Promise<boolean>; onDelete: (c: Comment) => void; canEdit: (c: Comment) => boolean; canDelete: (c: Comment) => boolean; readOnly: boolean }) {
  const people = useContext(PeopleCtx); const ME = useContext(MeCtx); const who = (id: string | null | undefined) => findPerson(people, id);
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const one = (x: Comment) => (
    <article className='cmt' aria-label={`Comment by ${who(x.author_id)?.name ?? 'Someone'}`}>
      <header><span className='who'>{who(x.author_id)?.name ?? 'Someone'}</span> <time dateTime={x.created_at}>{fmtTime(x.created_at)}</time>{x.edited_at && <span className='dim'> (edited)</span>}
        {!readOnly && editing !== x.id && (canEdit(x) || canDelete(x)) && <span className='cmt-actions'>{canEdit(x) && <button aria-label='Edit comment' onClick={() => setEditing(x.id)}>Edit</button>}{canDelete(x) && <button aria-label='Delete comment' onClick={() => onDelete(x)}>Delete</button>}</span>}</header>
      {editing === x.id ? <Composer label='Edit comment' initial={x.body} autoFocus submitLabel='Save' onSubmit={async (b) => { const ok = await onEdit(x, b); if (ok) setEditing(null); return ok; }} onCancel={() => setEditing(null)} /> : <Markdown source={x.body} empty='' />}
      <div className='reacts' role='group' aria-label='Reactions'>
        {EMOJIS.map((e) => { const r = x.reactions?.find((y) => y.emoji === e); return (r || !readOnly) && <button key={e} className={reactedBy(r, ME) ? 'on' : ''} aria-pressed={reactedBy(r, ME)} aria-label={`React ${e}${r ? `, ${r.count}` : ''}`} disabled={readOnly} onClick={() => onReact(x, e)}>{e}{r && <span>{r.count}</span>}</button>; })}
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

function Composer({ label, onSubmit, onCancel, autoFocus, initial = '', submitLabel }: { label: string; onSubmit: (b: string) => Promise<boolean>; onCancel?: () => void; autoFocus?: boolean; initial?: string; submitLabel?: string }) {
  const people = useContext(PeopleCtx);
  const [text, setText] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const at = activeMention(text, caret);
  const list = at ? suggest(mentionUsers(people), at.query) : [];
  const idx = Math.min(sel, Math.max(list.length - 1, 0));
  const listId = useId(); // stable across SSR and hydration (a Date.now() id made aria-controls mismatch)
  function choose(u: MentionUser) {
    if (!at) return;
    const r = insertMention(text, at, u);
    setText(r.text); setCaret(r.caret);
    requestAnimationFrame(() => { ref.current?.setSelectionRange(r.caret, r.caret); ref.current?.focus(); });
  }
  async function submit() { const b = text.trim(); if (!b) return; if (await onSubmit(b)) { if (!initial) { setText(''); setCaret(0); } } }
  return (
    <div className='composer'>
      <textarea ref={ref} autoFocus={autoFocus} aria-label={label} placeholder={`${label}… (@ to mention, ⌘↵ to send)`} rows={3} value={text}
        role='combobox' aria-expanded={list.length > 0} aria-controls={list.length > 0 ? listId : undefined} aria-autocomplete='list' aria-activedescendant={list[idx] ? `${listId}-${list[idx].id}` : undefined}
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
      <div className='composer-actions'>{onCancel && <button onClick={onCancel}>Cancel</button>}<button className='primary' disabled={!text.trim()} onClick={() => void submit()}>{submitLabel ?? (label === 'Reply' ? 'Reply' : 'Comment')}</button></div>
    </div>
  );
}

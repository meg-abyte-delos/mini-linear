'use client';
import { Inbox } from '@/components/Inbox';
import { httpInboxClient, mockInboxClient } from '@/lib/inbox-client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUSES, STATUS_LABEL, PRIORITY_LABEL, USERS, MOCK_META, fmtDate, scopeBadge, type Issue, type Meta, type Status } from '@/lib/issues';
import { Avatar, Icon, PriorityIcon, StatusIcon } from '@/components/icons';
import { fuzzyFilter } from '@/lib/fuzzy';
import { SHORTCUTS, createMatcher, formatKeys, isTypingTarget, keyOf } from '@/lib/shortcuts';
import { createStore } from '@/lib/mock-api';
import { MIN_QUERY, looksLikeIdentifier, searchApi, searchLocal, snippetParts, type SearchHit } from '@/lib/search-client';
import { bulkPatch as apiBulk, createIssue as apiCreate, isUuid, patchIssue as apiPatch } from '@/lib/api-client';
import { applyBulkLocal, BULK_MAX, chunk, inverseGroups, labelTogglePatch, type BulkGroup, type BulkPatch } from '@/lib/bulk';
import { SelectionBar, type BulkKind } from './SelectionBar';
import { visibleWindowVar, scrollToIndexVar, cardHeight } from '@/lib/virtual';
import { Picker, type PickOption } from '@/components/Picker';
import { ProjectDetail } from '@/components/ProjectDetail';
import { httpViewsClient, mockViewsClient, groupToFilters, viewUrl, type SavedView } from '@/lib/views-client';
import { FILTER_KEYS, NONE, activeCount, applyFilters, cycleBucket, emptyFilters, writeFilters, type FilterKey, type Filters, type CycleBucket } from '@/lib/filters';

type View = 'list' | 'board' | 'cycles' | 'projects' | 'inbox';
const FILTER_LABEL: Record<FilterKey, string> = { status: 'Status', priority: 'Priority', assignee: 'Assignee', label: 'Label', project: 'Project', cycle: 'Cycle' };
const BUCKETS: { id: CycleBucket; title: string }[] = [{ id: 'active', title: 'Active' }, { id: 'upcoming', title: 'Upcoming' }, { id: 'past', title: 'Past' }];
type PickKind = 'priority' | 'assignee' | 'label' | BulkKind;
interface Cmd { id: string; label: string; hint?: string; run: () => void; hit?: SearchHit }

function Column({ status, items, renderCard, selectedId, overZone, zone }: { status: Status; items: Issue[]; renderCard: (i: Issue, pos?: number, size?: number) => React.ReactNode; selectedId?: string; overZone: boolean; zone: object }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [vh, setVh] = useState(800);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => setVh(el.clientHeight || 800);
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Keep the selected card inside the rendered window (J/K moves selection through off-screen cards).
  const heights = useMemo(() => items.map((i) => cardHeight(i.label_ids.length)), [items]);
  const selIdx = selectedId ? items.findIndex((i) => i.id === selectedId) : -1;
  useEffect(() => {
    const el = ref.current; if (!el || selIdx < 0) return;
    const next = scrollToIndexVar(heights, selIdx, el.scrollTop, el.clientHeight || vh);
    if (next !== el.scrollTop) { el.scrollTop = next; setTop(next); }
  }, [selIdx, vh, heights]);
  const w = visibleWindowVar(heights, top, vh);
  return (
    <section className={`col${overZone ? ' over-zone' : ''}`} aria-labelledby={`c-${status}`} {...zone}>
      <h2 id={`c-${status}`}><StatusIcon status={status} /><span>{STATUS_LABEL[status]}</span><span className='count'>{items.length}</span></h2>
      <div className='col-scroll' ref={ref} onScroll={(e) => setTop(e.currentTarget.scrollTop)} data-testid={`col-${status}`}>
        <div role='listbox' aria-labelledby={`c-${status}`} style={{ paddingTop: w.padTop, paddingBottom: w.padBottom }}>
          {items.slice(w.start, w.end).map((i, k) => renderCard(i, w.start + k + 1, items.length))}
        </div>
        {!items.length && <p className='col-empty'>No issues</p>}
      </div>
    </section>
  );
}

export function Shell({ initialIssues, loadError = null, truncated = false, initialFilters = emptyFilters(), today, meta = MOCK_META, api = null, initialView = 'list', readOnly = false, initialIssueId }: { initialIssues: Issue[]; loadError?: string | null; truncated?: boolean; initialFilters?: Filters; today: string; meta?: Meta; api?: { slug: string; teamId: string } | null; initialView?: View; readOnly?: boolean; initialIssueId?: string }) {
  const router = useRouter();
  const { labels: LABELS, cycles: CYCLES, projects: PROJECTS } = meta;
  const [toast, setToast] = useState<string | null>(truncated ? 'Showing the first 10,000 issues only. Narrow with filters.' : null);
  // API mode: server versions by issue id, and one write chain per issue so If-Match never races our own PATCHes.
  const versions = useRef(new Map<string, number>(initialIssues.map((i) => [i.id, i.version])));
  const chains = useRef(new Map<string, Promise<unknown>>());
  const [storeInst] = useState(() => createStore(initialIssues));
  const store = useRef(storeInst);
  // The store is the single source of truth; React state is a snapshot refreshed after each mutation.
  const [allIssues, setIssues] = useState(() => store.current.list());
  const sync = () => setIssues(store.current.list());
  // Push a change to the API (no-op in mock mode). Local state is already updated (optimistic); the server row then wins.
  // 412 -> refetch the issue, toast "modified elsewhere", no automatic retry.
  function push(id: string, patch: Record<string, unknown>) {
    if (!api) return;
    const prev = store.current.list().find((x) => x.id === id);
    if (!prev) return;
    const run = async () => {
      const r = await apiPatch(api.slug, prev, versions.current.get(id) ?? prev.version, patch);
      if (r.issue) {
        versions.current.set(id, r.issue.version);
        // Success: keep the optimistic local row (no flicker), adopt only the server version/identifier. Conflict/error: the server copy wins.
        const local = store.current.list().find((x) => x.id === id);
        store.current.upsert(r.kind === 'ok' && local ? { ...local, version: r.issue.version, identifier: r.issue.identifier } : { ...r.issue, sort_key: prev.sort_key });
        sync();
      }
      if (r.kind === 'conflict') setToast('Issue modified elsewhere. Reloaded the latest version.');
      else if (r.kind === 'error') setToast('Could not save the change. Reloaded the latest version.');
    };
    chains.current.set(id, (chains.current.get(id) ?? Promise.resolve()).then(run, run));
  }
  const [filters, setFiltersState] = useState<Filters>(initialFilters);
  const [projPick, setProjPick] = useState<DOMRect | null | false>(false);
  const [filterPick, setFilterPick] = useState<{ kind: FilterKey; rect: DOMRect | null } | null>(null);
  const issues = useMemo(() => applyFilters(allIssues, filters), [allIssues, filters]);
  // Filters live in the URL: replaceState keeps other params (seed, state) and does not refetch.
  function setFilters(f: Filters) {
    setFiltersState(f);
    setActiveViewId(null); // an edited filter set is no longer the saved view
    const sp = new URLSearchParams(window.location.search); sp.delete('v');
    const qs = writeFilters(sp.toString(), f);
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
  }
  // Saved views (custom views): HTTP in API mode, in-memory otherwise. ?v=<id> opens one (shareable URL).
  const viewsClient = useMemo(() => (api ? httpViewsClient(api.slug) : mockViewsClient()), [api]);
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ name: string; shared: boolean; err: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  function applyView(v: SavedView) {
    const f = groupToFilters(v.filters);
    setFiltersState(f); setViewState(v.layout);
    setActiveViewId(v.id);
    const sp = new URLSearchParams(); sp.set('v', v.id);
    if (v.layout === 'board') sp.set('view', 'board');
    const qs = writeFilters(sp.toString(), f);
    window.history.replaceState(null, '', `${window.location.pathname}?${qs}${window.location.hash}`);
  }
  useEffect(() => {
    if (readOnly && api) return;
    let live = true;
    void viewsClient.list().then((list) => {
      if (!live) return;
      setViews(list);
      const want = new URLSearchParams(window.location.search).get('v');
      const hit = want ? list.find((x) => x.id === want) : undefined;
      if (hit) applyView(hit);
    });
    return () => { live = false; };
  }, [viewsClient]);
  async function saveView() {
    if (!saving) return;
    const name = saving.name.trim();
    if (!name) { setSaving({ ...saving, err: true }); return; }
    const row = await viewsClient.create({ name, shared: saving.shared, layout: view === 'board' ? 'board' : 'list', filters });
    if (!row) { setSaving({ ...saving, err: true }); return; }
    setViews((l) => [...l, row]); setSaving(null); setActiveViewId(row.id);
    const sp = new URLSearchParams(window.location.search); sp.set('v', row.id);
    window.history.replaceState(null, '', `${window.location.pathname}?${sp.toString().replace(/%2C/gi, ',')}${window.location.hash}`);
  }
  async function deleteView(v: SavedView) {
    if (!(await viewsClient.remove(v))) return;
    setViews((l) => l.filter((x) => x.id !== v.id));
    if (activeViewId === v.id) setFilters(emptyFilters());
  }
  function copyViewLink(v: SavedView) {
    const url = viewUrl(window.location.origin, window.location.pathname, v.id);
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(v.id); setTimeout(() => setCopied((c) => (c === v.id ? null : c)), 1500);
  }
  function toggleFilter(kind: FilterKey, id: string) {
    const cur = filters[kind];
    setFilters({ ...filters, [kind]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  }
  function filterOptions(kind: FilterKey): PickOption[] {
    const on = (id: string) => filters[kind].includes(id);
    if (kind === 'status') return STATUSES.map((st) => ({ id: st, label: STATUS_LABEL[st], checked: on(st), lead: <StatusIcon status={st} /> }));
    if (kind === 'priority') return PRIORITY_LABEL.map((l, n) => ({ id: String(n), label: l, checked: on(String(n)), lead: <PriorityIcon priority={n as Issue['priority']} /> }));
    if (kind === 'assignee') return [{ id: NONE, label: 'Unassigned', checked: on(NONE), lead: <span className='av av-none' aria-hidden='true' /> }, ...USERS.map((u) => ({ id: u.id, label: u.name, checked: on(u.id), lead: <Avatar initials={u.initials} hue={u.hue} /> }))];
    if (kind === 'label') return LABELS.map((l) => ({ id: l.id, label: l.name, badge: scopeBadge(l.scope), checked: on(l.id), lead: <span className={`chip ${l.hue}`} aria-hidden='true'>&nbsp;</span> }));
    if (kind === 'project') return [{ id: NONE, label: 'No project', checked: on(NONE) }, ...PROJECTS.map((p) => ({ id: p.id, label: p.name, checked: on(p.id) }))];
    return [{ id: NONE, label: 'No cycle', checked: on(NONE) }, ...CYCLES.map((c) => ({ id: c.id, label: c.name, checked: on(c.id) }))];
  }
  function filterValueLabel(kind: FilterKey): string {
    const o = filterOptions(kind).filter((x) => x.checked);
    return o.length === 1 ? o[0]!.label : `${o.length} selected`;
  }
  const [view, setViewState] = useState<View>(initialView);
  // The view lives in the URL too (?view=board|cycles; list is the default and drops the param).
  function setView(v: View) {
    setViewState(v);
    const sp = new URLSearchParams(window.location.search);
    if (v === 'list') sp.delete('view'); else sp.set('view', v);
    const qs = sp.toString().replace(/%2C/gi, ',');
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
  }
  const [detailId, setDetailId] = useState<string | null>(null); // project detail page (API mode)
  const [selId, setSelId] = useState<string | null>(initialIssueId ?? null);
  // Inbox: HTTP in API mode, in-memory seed otherwise. The unread badge polls every 30s (API mode only).
  const inboxClient = useMemo(() => (api ? httpInboxClient(api.slug) : mockInboxClient()), [api]);
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    let live = true;
    const tick = () => { void inboxClient.unreadCount().then((n) => { if (live) setUnreadCount(n); }); };
    tick();
    if (!api) return () => { live = false; };
    const t = setInterval(tick, 30000);
    return () => { live = false; clearInterval(t); };
  }, [inboxClient, api]);
  const [open, setOpen] = useState(!!initialIssueId);
  const [palette, setPalette] = useState(false);
  const [q, setQ] = useState('');
  const [pi, setPi] = useState(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [pick, setPick] = useState<{ kind: PickKind; id: string; ids: string[]; rect: DOMRect | null } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  // The drag source can unmount mid-drag (virtualized column scrolled away), so its own onDragEnd never fires: reset on window.
  useEffect(() => {
    const end = () => { dragRef.current = null; setDragId(null); setOverKey(null); };
    window.addEventListener('dragend', end);
    return () => window.removeEventListener('dragend', end);
  }, []);

  // Test hook, not product behaviour: e2e tests wait for html[data-ready] so key presses
  // are not sent before hydration has attached the handlers.
  useEffect(() => { document.documentElement.dataset.ready = '1'; return () => { delete document.documentElement.dataset.ready; }; }, []);

  const ordered = useMemo(() => STATUSES.flatMap((s) => issues.filter((i) => i.status === s)), [issues]);
  const current = ordered.find((i) => i.id === selId) ?? ordered[0];
  const orderedRef = useRef(ordered);
  const currentIdRef = useRef<string | undefined>(current?.id);

  // Bulk: with a multi-selection, an action applies to every selected issue; otherwise to the current one.
  const targetIds = () => (multiRef.current.length ? multiRef.current : currentIdRef.current ? [currentIdRef.current] : []);
  function cycleStatus() {
    if (readOnly) { setToast('Guests have read-only access.'); return; }
    for (const id of targetIds()) {
      const it = store.current.list().find((x) => x.id === id); if (!it) continue;
      const next = STATUSES[(STATUSES.indexOf(it.status) + 1) % STATUSES.length] as Status;
      store.current.update(id, { status: next });
      push(id, { status: next });
    }
    sync();
  }
  function setStatusBulk(st: Status) {
    if (readOnly) { setToast('Guests have read-only access.'); return; }
    const ids = targetIds();
    if (ids.length > 1) void applyBulk(ids, { status: st }, 'Status');
    else if (ids[0]) moveTo(ids[0], st, null);
  }
  // Drag and drop: drop on a section sets its status (appended); drop on a row/card inserts before it.
  // TODO(M2 ticket): order is client-side only. Only the status change goes to the API until a position field exists.
  function moveTo(id: string, status: Status, beforeId: string | null) {
    const was = store.current.list().find((x) => x.id === id)?.status;
    store.current.move(id, status, beforeId);
    if (was && was !== status) push(id, { status });
    sync();
    setSelId(id);
  }
  // Keyboard reorder (Alt+ArrowUp/Down): swap with the neighbour in the same status column.
  function reorder(dir: -1 | 1) {
    const id = currentIdRef.current; if (!id) return;
    const col = orderedRef.current.filter((i) => i.status === orderedRef.current.find((x) => x.id === id)?.status);
    const at = col.findIndex((i) => i.id === id), to = at + dir;
    if (at < 0 || to < 0 || to >= col.length) return;
    const before = dir < 0 ? col[to]!.id : (col[to + 1]?.id ?? null);
    moveTo(id, col[at]!.status, before);
  }
  const dragProps = (i: Issue) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData('text/plain', i.id); e.dataTransfer.effectAllowed = 'move'; dragRef.current = i.id; setDragId(i.id); },
    onDragEnd: () => { dragRef.current = null; setDragId(null); setOverKey(null); },
    onDragOver: (e: React.DragEvent) => { if (dragRef.current) { e.preventDefault(); e.stopPropagation(); setOverKey(i.id); } },
    onDrop: (e: React.DragEvent) => { const d = dragRef.current; if (!d) return; e.preventDefault(); e.stopPropagation(); moveTo(d, i.status, i.id); dragRef.current = null; setDragId(null); setOverKey(null); },
  });
  const zoneProps = (s: Status) => ({
    onDragOver: (e: React.DragEvent) => { if (dragRef.current) { e.preventDefault(); setOverKey(`z-${s}`); } },
    onDrop: (e: React.DragEvent) => { const d = dragRef.current; if (!d) return; e.preventDefault(); moveTo(d, s, null); dragRef.current = null; setDragId(null); setOverKey(null); },
  });
  function openPick(kind: PickKind, at?: DOMRect) {
    if (readOnly) { setToast('Guests have read-only access.'); return; }
    const ids = targetIds(); const id = ids[0]; if (!id) return;
    // Mock USERS ids are not UUIDs, so an assignment would be local-only: disabled in API mode until GET members exists.
    if (kind === 'assignee' && api) { setToast('Assignee picker needs the members API (not available yet).'); return; }
    const rect = at ?? document.querySelector<HTMLElement>(`[data-id="${id}"]`)?.getBoundingClientRect() ?? null;
    setPick({ kind, id, ids, rect });
  }
  function closePick() {
    const id = pick?.id; setPick(null);
    setTimeout(() => document.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus(), 0);
  }
  function applyPick(optId: string) {
    if (!pick) return;
    const items = pick.ids.map((id) => store.current.list().find((x) => x.id === id)).filter((x): x is Issue => !!x); if (!items.length) return;
    const NO = 'none';
    if (items.length > 1) {
      const k = pick.kind, ids = items.map((x) => x.id);
      if (k === 'label') { void applyBulk(ids, labelTogglePatch(items, optId), 'Labels'); return; }
      const m: Record<string, [string, BulkPatch]> = { priority: ['Priority', { priority: Number(optId) }], assignee: ['Assignee', { assignee_id: optId === NO ? null : optId }], status: ['Status', { status: optId as Status }], project: ['Project', { project_id: optId === NO ? null : optId }], cycle: ['Cycle', { cycle_id: optId === NO ? null : optId }] };
      const e = m[k]; if (e) void applyBulk(ids, e[1], e[0]);
      closePick(); return;
    }
    if (pick.kind === 'priority') { for (const cur of items) { store.current.update(cur.id, { priority: Number(optId) as Issue['priority'] }); push(cur.id, { priority: Number(optId) }); } sync(); closePick(); }
    else if (pick.kind === 'assignee') { for (const cur of items) { store.current.update(cur.id, { assignee_id: optId === 'none' ? null : optId }); if (isUuid(optId)) push(cur.id, { assignee_id: optId }); else if (optId === 'none') push(cur.id, { assignee_id: null }); /* mock USERS ids are not UUIDs: local only until GET members exists */ } sync(); closePick(); }
    else {
      // Label toggle on a selection: if every issue has it, remove it from all; otherwise add it to all.
      const all = items.every((c) => c.label_ids.includes(optId));
      for (const cur of items) { const label_ids = all ? cur.label_ids.filter((l) => l !== optId) : cur.label_ids.includes(optId) ? cur.label_ids : [...cur.label_ids, optId]; store.current.update(cur.id, { label_ids }); push(cur.id, { label_ids }); }
      sync();
    }
  }

  // Bulk edit: one optimistic local update, then POST /issues/bulk (API mode, chunks of 250). Failed ids are rolled back to their
  // previous row and reported; the successful part is undoable (Undo in the bar / toast) through the inverse patches.
  const [undo, setUndo] = useState<{ label: string; groups: BulkGroup[] } | null>(null);
  async function applyBulk(ids: string[], patch: BulkPatch, label: string, recordUndo = true) {
    const items = ids.map((id) => store.current.list().find((x) => x.id === id)).filter((x): x is Issue => !!x);
    if (!items.length) return;
    const groups = inverseGroups(items, patch);
    if (!groups.length) { setToast('Nothing to change.'); return; }
    for (const it of items) { const nx = applyBulkLocal(it, patch); if (patch.status !== undefined && nx.status !== it.status) store.current.move(it.id, nx.status, null); store.current.update(it.id, { priority: nx.priority, assignee_id: nx.assignee_id, project_id: nx.project_id, cycle_id: nx.cycle_id, label_ids: nx.label_ids }); }
    sync();
    let failed: { id: string; message: string }[] = [];
    if (api) {
      // Let our own queued PATCHes land first so the bulk does not race them (versions stay exact: +1 per updated issue).
      await Promise.all(ids.map((id) => chains.current.get(id)).filter(Boolean));
      const okIds: string[] = [];
      for (const part of chunk(ids, BULK_MAX)) {
        const r = await apiBulk(api.slug, part, patch as Record<string, unknown>);
        for (const id of r.succeeded) { versions.current.set(id, (versions.current.get(id) ?? items.find((x) => x.id === id)?.version ?? 0) + 1); okIds.push(id); }
        failed = failed.concat(r.failed);
      }
      for (const f of failed) { const orig = items.find((x) => x.id === f.id); if (orig) store.current.upsert(orig); }
      sync();
      if (recordUndo) groups.forEach((g) => { g.ids = g.ids.filter((id) => okIds.includes(id)); });
    }
    const done = ids.length - failed.length;
    setToast(failed.length ? `${label}: ${done} of ${ids.length} updated, ${failed.length} failed (${failed[0]!.message})` : `${label}: ${done} issue${done === 1 ? '' : 's'} updated`);
    if (recordUndo) setUndo(done > 0 ? { label, groups: groups.filter((g) => g.ids.length) } : null);
  }
  async function undoBulk() {
    const u = undo; if (!u) return;
    setUndo(null);
    for (const g of u.groups) await applyBulk(g.ids, g.patch, `Undo ${u.label.toLowerCase()}`, false);
  }

  function pickOptions(): PickOption[] {
    const sel = pick ? allIssues.filter((x) => pick.ids.includes(x.id)) : [];
    const cur = sel[0];
    if (!pick || !cur) return [];
    if (pick.kind === 'priority') return PRIORITY_LABEL.map((l, n) => ({ id: String(n), label: l, checked: sel.every((x) => x.priority === n), lead: <PriorityIcon priority={n as Issue['priority']} /> }));
    if (pick.kind === 'assignee') return [{ id: 'none', label: 'Unassigned', checked: sel.every((x) => x.assignee_id === null), lead: <span className='av av-none' aria-hidden='true' /> }, ...USERS.map((u) => ({ id: u.id, label: u.name, checked: sel.every((x) => x.assignee_id === u.id), lead: <Avatar initials={u.initials} hue={u.hue} /> }))];
    if (pick.kind === 'status') return STATUSES.map((st) => ({ id: st, label: STATUS_LABEL[st], checked: sel.every((x) => x.status === st), lead: <StatusIcon status={st} /> }));
    if (pick.kind === 'project') return [{ id: 'none', label: 'No project', checked: sel.every((x) => x.project_id === null) }, ...PROJECTS.map((p) => ({ id: p.id, label: p.name, checked: sel.every((x) => x.project_id === p.id) }))];
    if (pick.kind === 'cycle') return [{ id: 'none', label: 'No cycle', checked: sel.every((x) => x.cycle_id === null) }, ...CYCLES.map((c) => ({ id: c.id, label: c.name, checked: sel.every((x) => x.cycle_id === c.id) }))];
    return LABELS.map((l) => ({ id: l.id, label: l.name, badge: scopeBadge(l.scope), checked: sel.every((x) => x.label_ids.includes(l.id)), lead: <span className={`chip ${l.hue}`} aria-hidden='true'>&nbsp;</span> }));
  }
  // C must always show what it created: leave the cycles view, and drop filters the new issue would not match.
  function create() {
    if (readOnly) { setToast('Guests have read-only access.'); return; }
    if (api) {
      void apiCreate(api.slug, api.teamId, 'New issue').then((row) => {
        if (!row) { setToast('Could not create the issue.'); return; }
        versions.current.set(row.id, row.version);
        store.current.upsert({ ...row, sort_key: String(Date.now()) });
        sync();
        if (view === 'cycles' || view === 'projects') setView('list');
        setSelId(row.id);
      });
      return;
    }
    const made = store.current.create({ title: 'New issue' });
    sync();
    if (view === 'cycles' || view === 'projects') setView('list');
    if (made && activeCount(filters) > 0 && applyFilters([made], filters).length === 0) setFilters(emptyFilters());
    if (made) setSelId(made.id);
  }
  // Mock mode: the current user is the first mock user. API mode needs the session user + members API (same gap as the A picker).
  function assignToMe() {
    const id = currentIdRef.current; if (!id) return;
    if (api) { setToast('Assign to me needs the session user API (not available yet).'); return; }
    store.current.update(id, { assignee_id: USERS[0]!.id }); sync(); setToast(`Assigned to ${USERS[0]!.name}`);
  }
  function copyId() {
    const i = store.current.list().find((x) => x.id === currentIdRef.current); if (!i) return;
    const text = i.identifier ?? i.id;
    navigator.clipboard.writeText(text).then(() => setToast(`Copied ${text}`), () => setToast('Could not copy to the clipboard.'));
  }
  function goToProject(id: string) {
    setProjPick(false);
    setFilters({ ...emptyFilters(), project: [id] }); setView('list');
  }
  function openPalette() { returnFocus.current = document.activeElement as HTMLElement | null; setPalette(true); setQ(''); setPi(0); }
  function closePalette() { setPalette(false); const el = returnFocus.current; returnFocus.current = null; if (el && document.contains(el)) setTimeout(() => el.focus(), 0); }

  const [help, setHelpState] = useState(false);
  function setHelp(v: boolean) {
    if (v) returnFocus.current = document.activeElement as HTMLElement | null;
    setHelpState(v);
    if (!v) { const el = returnFocus.current; returnFocus.current = null; if (el && document.contains(el)) setTimeout(() => el.focus(), 0); }
  }
  const [multi, setMulti] = useState<string[]>([]);
  function toggleSelect(id: string | undefined) { if (id) setMulti((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id])); }
  // Shift+J/K: move the cursor and add both ends to the selection.
  function extend(dir: 1 | -1) {
    const list = orderedRef.current; if (!list.length) return;
    const idx = Math.max(0, list.findIndex((i) => i.id === currentIdRef.current));
    const n = Math.min(Math.max(idx + dir, 0), list.length - 1);
    setMulti((m) => Array.from(new Set([...m, list[idx]!.id, list[n]!.id])));
    setSelId(list[n]!.id);
  }
  const hint = (id: string) => { const d = SHORTCUTS.find((x) => x.id === id); return d ? formatKeys(d.keys).replace(' then ', ' ') : undefined; };
  const commands: Cmd[] = [
    { id: 'help', label: 'Keyboard shortcuts', hint: '?', run: () => setHelp(true) },
    { id: 'toggle-select', label: 'Select / unselect issue', hint: hint('toggle-select'), run: () => toggleSelect(currentIdRef.current) },
    { id: 'clear-select', label: 'Clear selection', run: () => setMulti([]) },
    { id: 'list', label: 'Go to issues', hint: hint('go-issues'), run: () => setView('list') },
    { id: 'board', label: 'Go to board view', hint: hint('go-views'), run: () => setView('board') },
    { id: 'cycles', label: 'Go to cycles', run: () => setView('cycles') },
    { id: 'projects', label: 'Go to projects', hint: hint('go-projects'), run: () => setView('projects') },
    { id: 'go-project', label: 'Go to project…', run: () => setTimeout(() => setProjPick(null), 0) },
    { id: 'clear-filters', label: 'Clear all filters', run: () => setFilters(emptyFilters()) },
    ...FILTER_KEYS.map((k) => ({ id: `filter-${k}`, label: `Filter by ${FILTER_LABEL[k].toLowerCase()}…`, run: () => { if (view === 'cycles' || view === 'projects') setView('list'); setTimeout(() => setFilterPick({ kind: k, rect: document.getElementById(`fb-${k}`)?.getBoundingClientRect() ?? null }), 0); } })),
    { id: 'status', label: multi.length > 1 ? `Cycle status of ${multi.length} selected` : 'Change status of selected issue', hint: 'S', run: cycleStatus },
    ...STATUSES.map((st) => ({ id: `move-${st}`, label: multi.length > 1 ? `Move ${multi.length} selected to ${STATUS_LABEL[st]}` : `Move to ${STATUS_LABEL[st]}`, run: () => setStatusBulk(st) })),
    { id: 'set-priority', label: 'Set priority…', hint: 'P', run: () => setTimeout(() => openPick('priority'), 0) },
    { id: 'set-assignee', label: 'Set assignee…', hint: 'A', run: () => setTimeout(() => openPick('assignee'), 0) },
    { id: 'set-label', label: 'Set label…', hint: 'L', run: () => setTimeout(() => openPick('label'), 0) },
    { id: 'assign-me', label: 'Assign to me', run: assignToMe },
    { id: 'copy-id', label: 'Copy issue id', run: copyId },
    { id: 'open', label: 'Open selected issue', hint: '↵', run: () => setOpen(true) },
  ];
  if (!readOnly) commands.splice(3, 0, { id: 'create', label: 'Create issue', hint: hint('create'), run: create });
  // Cmd+K search: top 8 hits from GET /search (API mode) or a local match (mock mode), debounced, stale responses dropped.
  const [hits, setHits] = useState<SearchHit[]>([]);
  const issuesRef = useRef<Issue[]>([]);
  issuesRef.current = allIssues;
  useEffect(() => {
    const term = q.trim();
    if (!palette || term.length < MIN_QUERY) { setHits([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      if (api) { const r = await searchApi(api.slug, term, { limit: 8, signal: ctl.signal }); if (!ctl.signal.aborted) setHits(r?.items ?? []); }
      else setHits(searchLocal(issuesRef.current, term, undefined, 8).items);
    }, api ? 150 : 0);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, palette, api]);
  function openHit(h: SearchHit) {
    if (h.kind === 'project') { goToProject(h.id); return; }
    setFilters(emptyFilters()); setView('list'); setSelId(h.issue_id ?? h.id); setOpen(true);
  }
  const matched = fuzzyFilter(commands, q, (c) => c.label);
  const hitCmds: Cmd[] = hits.map((h) => ({ id: `hit-${h.kind}-${h.id}`, label: `${h.identifier ? `${h.identifier} ` : ''}${h.title}`, hint: h.kind === 'issue' ? undefined : h.kind, run: () => openHit(h), hit: h }));
  const allCmd: Cmd[] = q.trim().length >= MIN_QUERY ? [{ id: 'search-all', label: `Search all for “${q.trim()}”`, run: () => router.push(`/search?q=${encodeURIComponent(q.trim())}`) }] : [];
  // An identifier-looking query (DEL-12) puts the hits first; otherwise commands keep priority.
  const results: Cmd[] = looksLikeIdentifier(q) ? [...hitCmds, ...matched, ...allCmd] : [...matched, ...hitCmds, ...allCmd];
  const actions = useRef({ reorder, create, cycleStatus, closePalette, openPalette, openPick, toggleSelect, extend, setView, setHelp, clearMulti: () => setMulti([]) });
  const paletteOpen = useRef(false);
  const helpOpen = useRef(false);
  const multiRef = useRef<string[]>([]);
  const readOnlyRef = useRef(readOnly);
  useEffect(() => { orderedRef.current = ordered; currentIdRef.current = current?.id; actions.current = { reorder, create, cycleStatus, closePalette, openPalette, openPick, toggleSelect, extend, setView, setHelp, clearMulti: () => setMulti([]) }; helpOpen.current = help; paletteOpen.current = palette; multiRef.current = multi; readOnlyRef.current = readOnly; });
  // Roving focus: when focus is inside the issue collection, follow the selection.
  useEffect(() => {
    const root = mainRef.current;
    if (!root || !current || !root.contains(document.activeElement) || document.activeElement === document.body) return;
    const el = root.querySelector<HTMLElement>(`[data-id="${current.id}"]`);
    if (el && el !== document.activeElement && (document.activeElement as HTMLElement).getAttribute('role') === 'option') el.focus();
  }, [current]);

  useEffect(() => {
    const matcher = createMatcher();
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); if (paletteOpen.current) actions.current.closePalette(); else actions.current.openPalette(); return;
      }
      const t = e.target as HTMLElement;
      if (isTypingTarget(t)) {
        if (e.key === 'Escape' && paletteOpen.current) actions.current.closePalette();
        return;
      }
      if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); actions.current.reorder(e.key === 'ArrowUp' ? -1 : 1); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (helpOpen.current && e.key !== 'Escape') return;
      // Bare modifier / navigation keydowns (Shift, Control, Tab...) must not reset a pending g sequence.
      if (e.key.length > 1 && e.key !== 'Enter' && e.key !== 'Escape') return;
      // The inbox owns its list keys while it is the current view.
      if (document.querySelector('main[data-view=inbox]') && ['j', 'k', 'u', 'e', 'h', 's', 'x', '1', '2', '3', 'Enter'].includes(e.key.length === 1 ? e.key.toLowerCase() : e.key)) return;
      const key = keyOf(e); if (!key) return;
      if (key === 'Enter' && t.closest('button, a, [role="button"], select')) { matcher.reset(); return; }
      const id = matcher.feed(key);
      if (!id) return;
      if (id === 'pending') { e.preventDefault(); return; }
      switch (id) {
        case 'escape':
          // One layer per press: overlay, then palette, then selection, then the detail panel.
          if (helpOpen.current) actions.current.setHelp(false);
          else if (paletteOpen.current) actions.current.closePalette();
          else if (multiRef.current.length) actions.current.clearMulti();
          else setOpen(false);
          break;
        case 'next': case 'prev': {
          const list = orderedRef.current; if (!list.length) break;
          const idx = Math.max(0, list.findIndex((i) => i.id === currentIdRef.current));
          setSelId(list[Math.min(Math.max(idx + (id === 'next' ? 1 : -1), 0), list.length - 1)]!.id); break;
        }
        case 'extend-next': e.preventDefault(); actions.current.extend(1); break;
        case 'extend-prev': e.preventDefault(); actions.current.extend(-1); break;
        case 'toggle-select': actions.current.toggleSelect(currentIdRef.current); break;
        case 'open': setOpen(true); break;
        case 'create': e.preventDefault(); if (!readOnlyRef.current) actions.current.create(); break;
        case 'status': actions.current.cycleStatus(); break;
        case 'priority': e.preventDefault(); actions.current.openPick('priority'); break;
        case 'assignee': e.preventDefault(); actions.current.openPick('assignee'); break;
        case 'label': e.preventDefault(); actions.current.openPick('label'); break;
        case 'go-issues': actions.current.setView('list'); break;
        case 'go-views': actions.current.setView('board'); break;
        case 'go-projects': actions.current.setView('projects'); break;
        case 'help': e.preventDefault(); actions.current.setHelp(true); break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const who = (id: string | null) => USERS.find((u) => u.id === id);
  const assignee = (i: Issue) => { const u = who(i.assignee_id); return u ? <Avatar initials={u.initials} hue={u.hue} /> : <span className='av av-none' aria-hidden='true' />; };
  const select = (i: Issue, openPanel: boolean) => { setSelId(i.id); if (openPanel) setOpen(true); };

  const row = (i: Issue) => (
    <div key={i.id} role='option' data-id={i.id} tabIndex={current?.id === i.id ? 0 : -1} aria-selected={current?.id === i.id} data-multi={multi.includes(i.id) || undefined} className={`row${dragId === i.id ? ' dragging' : ''}${overKey === i.id ? ' over' : ''}`} {...dragProps(i)} onClick={() => select(i, true)}>
      {!readOnly && <span className={`rowsel${multi.includes(i.id) ? ' on' : ''}`} aria-hidden='true' data-testid={`select-${i.identifier ?? i.id}`} onClick={(e) => { e.stopPropagation(); toggleSelect(i.id); }}>{multi.includes(i.id) ? '☑' : '☐'}</span>}
      <PriorityIcon priority={i.priority} />
      <span className='id'>{i.identifier ?? i.id}</span>
      <StatusIcon status={i.status} />
      <span className='title'>{i.title}</span>
      <span className='labels'>{i.label_ids.map((l) => { const lb = LABELS.find((x) => x.id === l); return lb ? <span key={l} className={`chip ${lb.hue}`}>{lb.name}</span> : null; })}</span>
      <span className='date'>{fmtDate(i.created_at)}</span>
      {assignee(i)}
    </div>
  );
  const card = (i: Issue, pos?: number, size?: number) => (
    <div key={i.id} role='option' aria-posinset={pos} aria-setsize={size} data-id={i.id} tabIndex={current?.id === i.id ? 0 : -1} aria-selected={current?.id === i.id} data-multi={multi.includes(i.id) || undefined} className={`card${dragId === i.id ? ' dragging' : ''}${overKey === i.id ? ' over' : ''}`} {...dragProps(i)} onClick={() => select(i, true)}>
      <div className='card-top'><span className='id'>{i.identifier ?? i.id}</span>{assignee(i)}</div>
      <div className='card-title'>{i.title}</div>
      <div className='card-meta'><PriorityIcon priority={i.priority} />{i.label_ids.map((l) => { const lb = LABELS.find((x) => x.id === l); return lb ? <span key={l} className={`chip ${lb.hue}`}>{lb.name}</span> : null; })}</div>
    </div>
  );

  return (
    <div className='shell'>
      <aside className='side' aria-label='Sidebar'>
        <div className='ws'><span className='ws-logo' aria-hidden='true'>D</span><span className='ws-name'>Delos</span></div>
        {!readOnly && <button className='side-btn new' onClick={create}><Icon name='plus' /><span>New issue</span><kbd>C</kbd></button>}
        <button className='side-btn' onClick={openPalette} aria-keyshortcuts='Meta+K Control+K'><Icon name='search' /><span>Search</span><kbd>⌘K</kbd></button>
        <nav aria-label='Primary'>
          <a className={`side-link${view === 'inbox' ? ' active' : ''}`} aria-current={view === 'inbox' ? 'page' : undefined} href='#inbox' onClick={(e) => { e.preventDefault(); setView('inbox'); }}><Icon name='inbox' /><span>Inbox</span>{unreadCount > 0 && <span className='badge' data-testid='inbox-badge' aria-label={`${unreadCount} unread notifications`}>{unreadCount > 99 ? '99+' : unreadCount}</span>}</a>
          <a className='side-link' href='#my-issues' onClick={(e) => e.preventDefault()}><Icon name='issues' /><span>My issues</span></a>
          <a className='side-link' href='#views' onClick={(e) => e.preventDefault()}><Icon name='views' /><span>Views</span></a>
          <div role='group' aria-label='Saved views' data-testid='saved-views'>
            {views.map((v) => (
              <div key={v.id} className='sv-row'>
                <a className={`side-link sub${activeViewId === v.id ? ' active' : ''}`} aria-current={activeViewId === v.id ? 'page' : undefined} href={`?v=${v.id}`} onClick={(e) => { e.preventDefault(); if (view === 'cycles' || view === 'projects' || view === 'inbox') setViewState('list'); applyView(v); }}><span>{v.name}</span>{v.shared && <span className='sv-tag'>Shared</span>}</a>
                <button className='sv-act' aria-label={`Copy link to ${v.name}`} onClick={() => copyViewLink(v)}>{copied === v.id ? 'Copied' : 'Link'}</button>
                {!readOnly && <button className='sv-act' aria-label={`Delete view ${v.name}`} onClick={() => void deleteView(v)}>×</button>}
              </div>
            ))}
          </div>
        </nav>
        <div className='side-label'>Your teams</div>
        <nav aria-label='Teams'>
          <a className='side-link' href='#team' onClick={(e) => e.preventDefault()}><Icon name='team' /><span>Delos</span></a>
          <a className={`side-link sub${view !== 'cycles' && view !== 'projects' && view !== 'inbox' ? ' active' : ''}`} aria-current={view !== 'cycles' && view !== 'projects' && view !== 'inbox' ? 'page' : undefined} href='#issues' onClick={(e) => { e.preventDefault(); if (view === 'cycles' || view === 'projects' || view === 'inbox') setView('list'); }}><span>Issues</span></a>
          <a className={`side-link sub${view === 'cycles' ? ' active' : ''}`} aria-current={view === 'cycles' ? 'page' : undefined} href='#cycles' onClick={(e) => { e.preventDefault(); setView('cycles'); }}><span>Cycles</span></a>
          <a className={`side-link sub${view === 'projects' ? ' active' : ''}`} aria-current={view === 'projects' ? 'page' : undefined} href='#projects' onClick={(e) => { e.preventDefault(); setView('projects'); }}><span>Projects</span></a>
        </nav>
      </aside>
      <main className='main' ref={mainRef} data-view={view}>
        <header className='head'>
          <div className='crumbs'><span>Delos</span><span className='sep'>/</span><h1 className='crumb-title'>{view === 'inbox' ? 'Inbox' : view === 'cycles' ? 'Cycles' : view === 'projects' ? 'Projects' : 'Issues'}</h1><span className='count'>{view === 'inbox' ? unreadCount : view === 'cycles' ? CYCLES.length : view === 'projects' ? PROJECTS.length : issues.length}</span></div>
          <div className='switch' role='group' aria-label='View'>
            <button aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name='list' /><span>List</span></button>
            <button aria-pressed={view === 'board'} onClick={() => setView('board')}><Icon name='board' /><span>Board</span></button>
          </div>
        </header>
        {view !== 'cycles' && view !== 'projects' && view !== 'inbox' && !loadError && allIssues.length > 0 && (
          <div className='filterbar' role='toolbar' aria-label='Filters'>
            {FILTER_KEYS.map((k) => (
              <button key={k} id={`fb-${k}`} className={`fchip${filters[k].length ? ' on' : ''}`} aria-haspopup='dialog' aria-expanded={filterPick?.kind === k} aria-pressed={filters[k].length > 0} onClick={(e) => setFilterPick({ kind: k, rect: e.currentTarget.getBoundingClientRect() })}>
                {FILTER_LABEL[k]}{filters[k].length > 0 && <span className='fval'>: {filterValueLabel(k)}</span>}
              </button>
            ))}
            {activeCount(filters) > 0 && <button className='fclear' onClick={() => setFilters(emptyFilters())}>Clear filters</button>}
            {activeCount(filters) > 0 && !readOnly && !activeViewId && !saving && <button className='fchip save-view' onClick={() => setSaving({ name: '', shared: false, err: false })}>Save view</button>}
            {saving && (
              <form className='save-form' onSubmit={(e) => { e.preventDefault(); void saveView(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setSaving(null); } }}>
                <input autoFocus aria-label='View name' aria-invalid={saving.err} placeholder='View name' maxLength={80} value={saving.name} onChange={(e) => setSaving({ ...saving, name: e.target.value, err: false })} />
                <label><input type='checkbox' checked={saving.shared} onChange={(e) => setSaving({ ...saving, shared: e.target.checked })} /> Shared</label>
                <button type='submit' className='fchip on'>Save</button>
                <button type='button' className='fclear' onClick={() => setSaving(null)}>Cancel</button>
                {saving.err && <span role='alert' className='save-err'>Enter a name (could not save).</span>}
              </form>
            )}
          </div>
        )}
        {loadError ? (
          <div className='state error' role='alert'>
            <p>{loadError}. Check your connection and try again.</p>
            <button onClick={() => router.refresh()}>Retry</button>
          </div>
        ) : allIssues.length === 0 ? (
          <div className='state empty' role='status'>
            <p>No issues yet.</p>
            {!readOnly && <button onClick={create}>Create issue <kbd>C</kbd></button>}
          </div>
        ) : view === 'inbox' ? (
          <Inbox client={inboxClient} onUnread={setUnreadCount} onOpenIssue={(id) => { setView('list'); setSelId(id); }} />
        ) : view === 'projects' && detailId && api ? (
          <ProjectDetail slug={api.slug} projectId={detailId} canWrite={!readOnly} onBack={() => setDetailId(null)} onViewIssues={(id) => { setDetailId(null); goToProject(id); }} />
        ) : view === 'projects' ? (
          <div className='scroll cycles'>
            <section className='group' aria-labelledby='pj-all'>
              <h2 id='pj-all'><span>All projects</span><span className='count'>{PROJECTS.length}</span></h2>
              {PROJECTS.length === 0 ? <p className='col-empty'>No projects</p> : PROJECTS.map((p) => {
                const its = allIssues.filter((i) => i.project_id === p.id);
                const done = its.filter((i) => i.status === 'done' || i.status === 'canceled').length;
                const pct = its.length ? Math.round((done / its.length) * 100) : 0;
                return (
                  <div key={p.id} className='cycle project' data-project={p.id}>
                    <span className='cy-name'>{p.name}</span>
                    <span className='cy-dates'>{its.length} {its.length === 1 ? 'issue' : 'issues'}</span>
                    <span className='cy-prog' role='img' aria-label={`${pct}% complete, ${done} of ${its.length} issues`}><span style={{ width: `${pct}%` }} /></span>
                    <span className='cy-count'>{done}/{its.length}</span>
                    {api && <button onClick={() => setDetailId(p.id)}>Open</button>}<button onClick={() => goToProject(p.id)}>View issues</button>
                  </div>
                );
              })}
            </section>
          </div>
        ) : view === 'cycles' ? (
          <div className='scroll cycles'>
            {BUCKETS.map((b) => {
              const cs = CYCLES.filter((c) => cycleBucket(c, today) === b.id);
              return (
                <section key={b.id} className='group' aria-labelledby={`cy-${b.id}`}>
                  <h2 id={`cy-${b.id}`}><span>{b.title}</span><span className='count'>{cs.length}</span></h2>
                  {cs.length === 0 ? <p className='col-empty'>No {b.id} cycles</p> : cs.map((c) => {
                    // Progress ignores list filters on purpose; cycle_id already scopes issues to the cycle's team.
                    const its = allIssues.filter((i) => i.cycle_id === c.id);
                    const done = its.filter((i) => i.status === 'done' || i.status === 'canceled').length;
                    const pct = its.length ? Math.round((done / its.length) * 100) : 0;
                    return (
                      <div key={c.id} className='cycle' data-cycle={c.id} data-bucket={b.id}>
                        <span className='cy-name'>{c.name}</span>
                        <span className='cy-dates'>{fmtDate(c.start_date)} to {fmtDate(c.end_date)}</span>
                        <span className='cy-prog' role='img' aria-label={`${pct}% complete, ${done} of ${its.length} issues`}><span style={{ width: `${pct}%` }} /></span>
                        <span className='cy-count'>{done}/{its.length}</span>
                        <button onClick={() => { setFilters({ ...emptyFilters(), cycle: [c.id] }); setView('list'); }}>View issues</button>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        ) : issues.length === 0 ? (
          <div className='state empty' role='status'>
            <p>No issues match these filters.</p>
            <button onClick={() => setFilters(emptyFilters())}>Clear filters</button>
          </div>
        ) : view === 'list' ? (
          <div className='scroll'>
            {STATUSES.map((s) => {
              const items = issues.filter((i) => i.status === s);
              if (!items.length) return null;
              return (
                <section key={s} className={`group${overKey === `z-${s}` ? ' over-zone' : ''}`} aria-labelledby={`g-${s}`} {...zoneProps(s)}>
                  <h2 id={`g-${s}`}><StatusIcon status={s} /><span>{STATUS_LABEL[s]}</span><span className='count'>{items.length}</span></h2>
                  <div role='listbox' aria-labelledby={`g-${s}`}>{items.map(row)}</div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className='board'>
            {STATUSES.map((s) => (
              <Column key={s} status={s} items={issues.filter((i) => i.status === s)} renderCard={card} selectedId={current?.id} overZone={overKey === `z-${s}`} zone={zoneProps(s)} />
            ))}
          </div>
        )}
      </main>
      {open && current && (
        <aside className='panel' aria-label='Issue detail'>
          <div className='panel-head'><span className='id'>{current.identifier ?? current.id}</span><a href={`/w/${api?.slug ?? 'delos'}/issue/${current.identifier ?? current.id}`}>Open</a><button onClick={() => setOpen(false)} aria-label='Close detail panel'>Esc</button></div>
          <h2>{current.title}</h2>
          <dl>
            <dt>Status</dt><dd><StatusIcon status={current.status} />{STATUS_LABEL[current.status]}</dd>
            <dt>Priority</dt><dd><PriorityIcon priority={current.priority} />{PRIORITY_LABEL[current.priority]}</dd>
            <dt>Labels</dt><dd>{current.label_ids.length ? current.label_ids.map((l) => LABELS.find((x) => x.id === l)?.name).join(', ') : 'None'}</dd>
            <dt>Assignee</dt><dd>{assignee(current)}{who(current.assignee_id)?.name ?? 'Unassigned'}</dd>
          </dl>
        </aside>
      )}
      {multi.length > 1 && !readOnly && <SelectionBar count={multi.length} canUndo={!!undo} onAction={(k, r) => openPick(k, r)} onUndo={() => void undoBulk()} onClear={() => setMulti([])} />}
      {multi.length > 0 && <div className='toast' role='status'>{multi.length} selected, Esc to clear</div>}
      {help && (
        <div className='overlay' onClick={() => setHelp(false)}>
          <div className='palette' role='dialog' aria-modal='true' aria-label='Keyboard shortcuts' onClick={(e) => e.stopPropagation()} ref={(el) => el?.focus()} tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setHelp(false); } else if (e.key === 'Tab') e.preventDefault(); /* focus trap: the dialog is the only focusable element */ }}>
            {(['Issues', 'Navigation', 'Selection', 'General'] as const).map((g) => (
              <section key={g}><h3>{g}</h3><ul>{SHORTCUTS.filter((d) => d.group === g).map((d) => <li key={d.id}><span>{d.label}</span><kbd>{formatKeys(d.keys)}</kbd></li>)}</ul></section>
            ))}
          </div>
        </div>
      )}
      {toast && <div className='toast' role='status' onClick={() => setToast(null)}>{toast}</div>}
      {pick && <Picker title={({ priority: 'Set priority', assignee: 'Set assignee', label: 'Set labels', status: 'Set status', project: 'Set project', cycle: 'Set cycle' } as const)[pick.kind]} multi={pick.kind === 'label'} anchor={pick.rect} options={pickOptions()} onPick={applyPick} onClose={closePick} />}
      {projPick !== false && <Picker title='Go to project' anchor={projPick} options={PROJECTS.map((p) => ({ id: p.id, label: p.name }))} onPick={goToProject} onClose={() => setProjPick(false)} />}
      {filterPick && <Picker title={`Filter by ${FILTER_LABEL[filterPick.kind].toLowerCase()}`} multi anchor={filterPick.rect} options={filterOptions(filterPick.kind)} onPick={(id) => toggleFilter(filterPick.kind, id)} onClose={() => { const k = filterPick.kind; setFilterPick(null); setTimeout(() => document.getElementById(`fb-${k}`)?.focus(), 0); }} />}
      {palette && (
        <div className='overlay' onClick={closePalette}>
          <div className='palette' ref={dialogRef} role='dialog' aria-modal='true' aria-label='Command palette' onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== 'Tab') return;
              const f = dialogRef.current?.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]');
              if (!f || f.length === 0) return;
              const first = f[0] as HTMLElement; const last = f[f.length - 1] as HTMLElement;
              if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
              else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
              else if (f.length === 1) e.preventDefault();
            }}>
            <input
              autoFocus role='combobox' aria-expanded='true' aria-controls='palette-list' aria-activedescendant={results[pi] ? `pc-${results[pi].id}` : undefined} aria-autocomplete='list' aria-label='Search commands' placeholder='Type a command or search issues…' value={q}
              onChange={(e) => { setQ(e.target.value); setPi(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setPi((p) => Math.min(p + 1, results.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setPi((p) => Math.max(p - 1, 0)); }
                else if (e.key === 'Enter') { const c = results[pi]; closePalette(); c?.run(); }
              }}
            />
            <ul id='palette-list' role='listbox' aria-label='Commands'>
              {results.map((c, idx) => (
                <li key={c.id} id={`pc-${c.id}`} role='option' aria-selected={idx === pi} onClick={() => { closePalette(); c.run(); }}><span>{c.hit ? <>{c.hit.identifier && <b className='hit-id'>{c.hit.identifier} </b>}{c.hit.kind === 'comment' ? snippetParts(c.hit.snippet).map((p, k) => (p.mark ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>)) : c.hit.title}</> : c.label}</span>{c.hint && <kbd>{c.hint}</kbd>}</li>
              ))}
              {results.length === 0 && <li role='option' aria-selected='false' aria-disabled='true'>No matching command</li>}
            </ul>
            <div className='palette-foot'><kbd>↑↓</kbd> navigate <kbd>↵</kbd> run <kbd>esc</kbd> close</div>
          </div>
        </div>
      )}
    </div>
  );
}

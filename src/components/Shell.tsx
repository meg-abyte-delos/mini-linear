'use client';
import { EmptyState, Menu, Tooltip, type MenuEntry } from '@/components/ui';
import { withViewTransition } from '@/lib/motion';
import { Inbox } from '@/components/Inbox';
import { httpInboxClient, mockInboxClient } from '@/lib/inbox-client';
import { useRouter } from 'next/navigation';
import { useCssVars } from '@/lib/ui/use-css-vars';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STATUSES, STATUS_LABEL, PRIORITY_LABEL, USERS, MOCK_META, fmtDate, scopeBadge, type Issue, type Meta, type Status } from '@/lib/issues';
import { PropIcon } from '@/components/PropIcons';
import { Avatar, Icon, PriorityIcon, StatusIcon, UnassignedIcon } from '@/components/icons';
import { fuzzyFilter } from '@/lib/fuzzy';
import { ProgressRing } from '@/components/ProgressRing';
import { subIssueStats } from '@/lib/sub-issues';
import { SHORTCUTS, createMatcher, formatKeys, isTypingTarget, keyOf } from '@/lib/shortcuts';
import { createStore } from '@/lib/sim-store';
import { fetchAllIssues, startIssueRealtime } from '@/lib/realtime-bridge';
import { MIN_QUERY, searchApi, searchLocal, snippetParts, type SearchHit } from '@/lib/search-client';
import { CyclesList } from '@/components/CyclesList';
import { parseNlCommand, nlLabel } from '@/lib/nl-command';
import { EMPTY_PEOPLE, fetchNlPeople, type NlPeople } from '@/lib/nl-people';
import { DISPLAY_PROP_LABEL, GROUPING_LABEL, ORDERING_LABEL, type DisplayProp, fitLabels, listGroups, relDate, visibleOrder, type Grouping, type Ordering } from '@/lib/list-ui';
import { MOCK_PEOPLE, findPerson, peopleFromNl, type Person } from '@/lib/people';
import { bulkPatch as apiBulk, createIssue as apiCreate, isUuid, patchIssue as apiPatch } from '@/lib/api-client';
import { applyBulkLocal, BULK_MAX, chunk, inverseGroups, labelTogglePatch, type BulkGroup, type BulkPatch } from '@/lib/bulk';
import { ConfirmDialog } from '@/components/ui';
import { detailApi } from '@/lib/detail/api';
import { SelectionBar, type BulkKind } from './SelectionBar';
import { visibleWindowVar, scrollToIndexVar, cardHeight } from '@/lib/virtual';
import { Picker, type PickOption } from '@/components/Picker';
import { ProjectDetail } from '@/components/ProjectDetail';
import { ProjectsList } from '@/components/ProjectsList';
import { httpViewsClient, mockViewsClient, groupToFilters, viewUrl, type SavedView } from '@/lib/views-client';
import { FILTER_KEYS, NONE, activeCount, applyFilters, emptyFilters, writeFilters, type FilterKey, type Filters } from '@/lib/filters';
import { WorkspaceSwitcher, TeamSection, SideIcon } from '@/components/SidebarParts';
import { listTeams, type Team } from '@/lib/settings-client';
import { DisplayPick } from '@/components/DisplayPick';
import { NewIssueModal, type NewIssueDraft } from '@/components/NewIssueModal';
import { FilterMenu } from '@/components/FilterMenu';

type View = 'list' | 'board' | 'cycles' | 'projects' | 'inbox';
// Linear-like view tabs above the list: each one is a status filter set (A5 saved views stay in the sidebar).
const VIEW_TABS: { id: string; label: string; status: readonly string[] }[] = [
  { id: 'all', label: 'All issues', status: [] },
  { id: 'active', label: 'Active', status: ['todo', 'in_progress', 'in_review'] },
  { id: 'backlog', label: 'Backlog', status: ['backlog'] },
];
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && b.every((x) => a.includes(x));
const FILTER_LABEL: Record<FilterKey, string> = { status: 'Status', priority: 'Priority', assignee: 'Assignee', label: 'Label', project: 'Project', cycle: 'Cycle' };
type PickKind = 'priority' | 'assignee' | 'label' | BulkKind;
interface Cmd { id: string; label: string; hint?: string; run: () => void; hit?: SearchHit; disabled?: boolean }

function Column({ status, items, renderCard, selectedId, overZone, zone, onAdd, onHide, folded, onFold }: { status: Status; items: Issue[]; renderCard: (i: Issue, pos?: number, size?: number) => React.ReactNode; selectedId?: string; overZone: boolean; zone: object; onAdd?: (s: Status) => void; onHide?: (s: Status) => void; folded: boolean; onFold: (s: Status) => void }) {
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
  const heights = useMemo(() => items.map((i) => cardHeight(i.label_ids.length, i.title.length)), [items]);
  const selIdx = selectedId ? items.findIndex((i) => i.id === selectedId) : -1;
  useEffect(() => {
    const el = ref.current; if (!el || selIdx < 0) return;
    const next = scrollToIndexVar(heights, selIdx, el.scrollTop, el.clientHeight || vh);
    if (next !== el.scrollTop) { el.scrollTop = next; setTop(next); }
  }, [selIdx, vh, heights]);
  const w = visibleWindowVar(heights, top, vh);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const entries: MenuEntry[] = [
    ...(onAdd ? [{ id: 'add', label: 'Add issue', onSelect: () => onAdd(status) }] : []),
    { id: 'fold', label: folded ? 'Expand column' : 'Collapse column', onSelect: () => onFold(status) },
    ...(onHide ? [{ id: 'hide', label: 'Hide column', onSelect: () => onHide(status) }] : []),
  ];
  const listRef = useRef<HTMLDivElement>(null);
  useCssVars(listRef, { '--pad-top': `${w.padTop}px`, '--pad-bottom': `${w.padBottom}px` });
  return (
    <section className={`col${overZone ? ' over-zone' : ''}${folded ? ' folded' : ''}`} aria-labelledby={`c-${status}`} {...zone}>
      <div className='col-head'>
        <h2 id={`c-${status}`}><StatusIcon status={status} /><span>{STATUS_LABEL[status]}</span><span className='count'>{items.length}</span></h2>
        <button type='button' ref={moreRef} className='col-act' aria-label={`${STATUS_LABEL[status]} column options`} title='Column options' aria-haspopup='menu' aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name='more' /></button>
        {onAdd && <button type='button' className='col-act' aria-label={`Add issue to ${STATUS_LABEL[status]}`} title='Add issue' onClick={() => onAdd(status)}><Icon name='plus' /></button>}
        <Menu open={menu} anchorRef={moreRef} onClose={() => setMenu(false)} label={`${STATUS_LABEL[status]} column`} entries={entries} align='end' />
      </div>
      <div className='col-scroll' ref={ref} onScroll={(e) => setTop(e.currentTarget.scrollTop)} data-testid={`col-${status}`}>
        <div ref={listRef} className='col-list' role='listbox' aria-labelledby={`c-${status}`}>
          {items.slice(w.start, w.end).map((i, k) => renderCard(i, w.start + k + 1, items.length))}
        </div>
        {!items.length && <p className='col-empty'>No issues</p>}
      </div>
    </section>
  );
}

// Cmd+K sections and icons, derived from the command id (Linear groups results under small labels).
const NAV_IDS = new Set(['list', 'board', 'cycles', 'projects', 'go-project']);
function paletteGroup(id: string): string {
  if (id === 'nl') return 'Suggested';
  if (id.startsWith('hit-')) return 'Issues';
  if (id === 'search-all') return 'Search';
  if (NAV_IDS.has(id)) return 'Navigation';
  if (id.startsWith('filter-') || id === 'clear-filters') return 'Filters';
  return 'Issue actions';
}
function paletteIcon(id: string) {
  if (id === 'list' || id === 'go-project') return <Icon name='list' />;
  if (id === 'board') return <Icon name='board' />;
  if (id === 'cycles') return <Icon name='cycle' />;
  if (id === 'projects') return <Icon name='team' />;
  if (id === 'create') return <Icon name='plus' />;
  if (id === 'search-all' || id.startsWith('filter-')) return <Icon name='search' />;
  if (id.startsWith('hit-')) return <Icon name='issues' />;
  return <Icon name='inbox' />;
}

// Cmd+K: highlight the typed term inside an issue title (case-insensitive, first match), like Linear.
function markTerm(text: string, term: string) {
  const t = term.trim(); const i = t.length >= MIN_QUERY ? text.toLowerCase().indexOf(t.toLowerCase()) : -1;
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + t.length)}</mark>{text.slice(i + t.length)}</>;
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
  // API mode: live updates from the SSE change feed (other tabs/users). Own writes are skipped by version.
  const [rtTick, setRtTick] = useState(0);
  useEffect(() => {
    if (!api) return;
    return startIssueRealtime({
      slug: api.slug,
      known: (id) => versions.current.get(id),
      upsert: (row) => {
        const prev = store.current.list().find((x) => x.id === row.id);
        versions.current.set(row.id, row.version);
        store.current.upsert({ ...row, sort_key: prev?.sort_key ?? String(store.current.list().length).padStart(8, '0') });
        sync();
      },
      remove: (id) => { store.current.remove(id); versions.current.delete(id); sync(); },
      resync: async () => {
        const rows = await fetchAllIssues(api.slug);
        const have = new Set(rows.map((r) => r.id));
        for (const cur of store.current.list()) if (!have.has(cur.id)) store.current.remove(cur.id);
        rows.forEach((r, i) => { versions.current.set(r.id, r.version); store.current.upsert({ ...r, sort_key: store.current.list().find((x) => x.id === r.id)?.sort_key ?? String(i).padStart(8, '0') }); });
        sync();
      },
      onActivity: () => setRtTick((n) => n + 1),
    });
  }, [api?.slug]);
  // NL palette: real people (me + workspace members) in API mode.
  const [nlPeople, setNlPeople] = useState<NlPeople>(EMPTY_PEOPLE);
  const [nlPeopleLoaded, setNlPeopleLoaded] = useState(false);
  useEffect(() => {
    if (!api) return;
    let live = true;
    setNlPeople(EMPTY_PEOPLE); setNlPeopleLoaded(false);
    void fetchNlPeople(api.slug).then((p) => { if (live) setNlPeople(p); }).finally(() => { if (live) setNlPeopleLoaded(true); });
    return () => { live = false; };
  }, [api?.slug]);
  const issueById = useMemo(() => new Map(allIssues.map((x) => [x.id, x] as const)), [allIssues]);
  const getIssue = useCallback((id: string) => issueById.get(id), [issueById]);
  const people = useMemo<readonly Person[]>(() => (api ? peopleFromNl(nlPeople) : MOCK_PEOPLE), [api, nlPeople]);
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
  const [hiddenCols, setHiddenCols] = useState<Set<Status>>(() => new Set());
  // Fold state lives here so hiding then showing a column keeps it.
  const [foldedCols, setFoldedCols] = useState<Set<Status>>(() => new Set());
  const toggleIn = (set: Set<Status>, st: Status, on?: boolean) => { const n = new Set(set); if (on ?? !n.has(st)) n.add(st); else n.delete(st); return n; };
  const [filters, setFiltersState] = useState<Filters>(initialFilters);
  const [projPick, setProjPick] = useState<DOMRect | null | false>(false);
  const [filterPick, setFilterPick] = useState<{ kind: FilterKey; rect: DOMRect | null } | null>(null);
  const [tbMenu, setTbMenu] = useState<'filter' | 'display' | null>(null);
  const [grouping, setGrouping] = useState<Grouping>('status');
  const [ordering, setOrdering] = useState<Ordering>('manual');
  const [showEmpty, setShowEmpty] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<DisplayProp>>(new Set());
  const shown = (k: DisplayProp) => !hidden.has(k);
  const toggleProp = (k: DisplayProp) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleGroup = (k: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const issues = useMemo(() => applyFilters(allIssues, filters), [allIssues, filters]);
  const subStats = useMemo(() => subIssueStats(allIssues), [allIssues]);
  const subBadge = (i: Issue) => { const st = subStats.get(i.id); return st ? <span className='sub-prog' data-testid={`sub-${i.identifier ?? i.id}`} title={`${st.done} of ${st.total} sub-issues done`}><ProgressRing pct={st.pct} size={14} showPct={false} label={`${st.done} of ${st.total} sub-issues done`} /><span>{st.done}/{st.total}</span></span> : null; };
  // Filters live in the URL: replaceState keeps other params (seed, state) and does not refetch.
  function setFilters(f: Filters) {
    setFiltersState(f);
    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- event handler, runs after render
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
    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- event handler, runs after render
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
    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- event handler, runs after render
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
    if (kind === 'assignee') return [{ id: NONE, label: 'Unassigned', checked: on(NONE), lead: <UnassignedIcon /> }, ...people.map((u) => ({ id: u.id, label: u.name, checked: on(u.id), lead: <Avatar initials={u.initials} hue={u.hue} /> }))];
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
    if (v !== view) withViewTransition(() => setViewState(v)); else setViewState(v);
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

  // Same grouping, ordering and collapsed state as the list render, so j/k never lands on a hidden row.
  const groups = useMemo(() => listGroups(issues, STATUSES, grouping, ordering, showEmpty), [issues, grouping, ordering, showEmpty]);
  const ordered = useMemo(
    () => (view === 'list' ? visibleOrder(groups, collapsed) : STATUSES.filter((s) => !hiddenCols.has(s)).flatMap((s) => issues.filter((i) => i.status === s))),
    [view, groups, collapsed, issues, hiddenCols],
  );
  // Manual ordering only: with priority/created ordering a drop position would be meaningless.
  const canDrag = view !== 'list' || ordering === 'manual';
  const current = ordered.find((i) => i.id === selId) ?? ordered[0];
  const orderedRef = useRef(ordered);
  const currentIdRef = useRef<string | undefined>(current?.id);
  const multiRef = useRef<string[]>([]);

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
  const dragProps = (i: Issue) => (!canDrag ? {} : {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData('text/plain', i.id); e.dataTransfer.effectAllowed = 'move'; dragRef.current = i.id; setDragId(i.id); },
    onDragEnd: () => { dragRef.current = null; setDragId(null); setOverKey(null); },
    onDragOver: (e: React.DragEvent) => { if (dragRef.current) { e.preventDefault(); e.stopPropagation(); setOverKey(i.id); } },
    onDrop: (e: React.DragEvent) => { const d = dragRef.current; if (!d) return; e.preventDefault(); e.stopPropagation(); moveTo(d, i.status, i.id); dragRef.current = null; setDragId(null); setOverKey(null); },
  });
  const zoneProps = (s: Status) => (!canDrag ? {} : {
    onDragOver: (e: React.DragEvent) => { if (dragRef.current) { e.preventDefault(); setOverKey(`z-${s}`); } },
    onDrop: (e: React.DragEvent) => { const d = dragRef.current; if (!d) return; e.preventDefault(); moveTo(d, s, null); dragRef.current = null; setDragId(null); setOverKey(null); },
  });
  function openPick(kind: PickKind, at?: DOMRect) {
    if (readOnly) { setToast('Guests have read-only access.'); return; }
    const ids = targetIds(); const id = ids[0]; if (!id) return;
    if (kind === 'assignee' && api && !nlPeopleLoaded) { setToast('Loading members…'); return; }
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
    if (items.length > 1 || pick.kind === 'status' || pick.kind === 'project' || pick.kind === 'cycle') {
      const k = pick.kind, ids = items.map((x) => x.id);
      if (k === 'label') { void applyBulk(ids, labelTogglePatch(items, optId), 'Labels'); return; }
      const m: Record<string, [string, BulkPatch]> = { priority: ['Priority', { priority: Number(optId) }], assignee: ['Assignee', { assignee_id: optId === NO ? null : optId }], status: ['Status', { status: optId as Status }], project: ['Project', { project_id: optId === NO ? null : optId }], cycle: ['Cycle', { cycle_id: optId === NO ? null : optId }] };
      const e = m[k]; if (e) void applyBulk(ids, e[1], e[0]);
      closePick(); return;
    }
    if (pick.kind === 'priority') { for (const cur of items) { store.current.update(cur.id, { priority: Number(optId) as Issue['priority'] }); push(cur.id, { priority: Number(optId) }); } sync(); closePick(); }
    else if (pick.kind === 'assignee') { for (const cur of items) { store.current.update(cur.id, { assignee_id: optId === 'none' ? null : optId }); if (isUuid(optId)) push(cur.id, { assignee_id: optId }); else if (optId === 'none') push(cur.id, { assignee_id: null }); } sync(); closePick(); }
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
    if (pick.kind === 'assignee') return [{ id: 'none', label: 'Unassigned', checked: sel.every((x) => x.assignee_id === null), lead: <UnassignedIcon /> }, ...people.map((u) => ({ id: u.id, label: u.name, checked: sel.every((x) => x.assignee_id === u.id), lead: <Avatar initials={u.initials} hue={u.hue} /> }))];
    if (pick.kind === 'status') return STATUSES.map((st) => ({ id: st, label: STATUS_LABEL[st], checked: sel.every((x) => x.status === st), lead: <StatusIcon status={st} /> }));
    if (pick.kind === 'project') return [{ id: 'none', label: 'No project', checked: sel.every((x) => x.project_id === null) }, ...PROJECTS.map((p) => ({ id: p.id, label: p.name, checked: sel.every((x) => x.project_id === p.id) }))];
    if (pick.kind === 'cycle') return [{ id: 'none', label: 'No cycle', checked: sel.every((x) => x.cycle_id === null) }, ...CYCLES.map((c) => ({ id: c.id, label: c.name, checked: sel.every((x) => x.cycle_id === c.id) }))];
    return LABELS.map((l) => ({ id: l.id, label: l.name, badge: scopeBadge(l.scope), checked: sel.every((x) => x.label_ids.includes(l.id)), lead: <span className={`chip ${l.hue}`} aria-hidden='true'>&nbsp;</span> }));
  }
  // C, the New issue button and the palette open the modal: an issue is only created from it, never untitled.
  const [newIssue, setNewIssue] = useState<{ status?: Status } | null>(null);
  const newOpen = useRef(false);
  newOpen.current = newIssue !== null;
  function create(status?: Status) {
    if (readOnly) { setToast('Guests have read-only access.'); return; }
    setNewIssue({ ...(typeof status === 'string' ? { status } : {}) });
  }
  // C must always show what it created: leave the cycles view, and drop filters the new issue would not match.
  async function submitNew(d: NewIssueDraft): Promise<boolean> {
    const extra: Record<string, unknown> = {};
    if (d.description) extra.description = d.description;
    if (d.priority !== 0) extra.priority = d.priority;
    if (d.assignee_id) extra.assignee_id = d.assignee_id;
    if (d.label_ids.length) extra.label_ids = d.label_ids;
    if (d.project_id) extra.project_id = d.project_id;
    let made: Issue | null | undefined;
    let patchFailed = false;
    if (api) {
      const row = await apiCreate(api.slug, d.team_id || api.teamId, d.title);
      if (!row) { setToast('Could not create the issue.'); return false; }
      if (d.team_id && d.team_id !== api.teamId) {
        // Another team's issue does not belong in this team's store: apply the properties server-side, then just confirm.
        const other = { ...extra, ...(row.status !== d.status ? { status: d.status } : {}) };
        let failed = false;
        if (Object.keys(other).length) { const r = await apiPatch(api.slug, row, row.version, other); failed = r.kind !== 'ok'; }
        setToast(failed ? `Created ${row.identifier ?? d.title}, but some properties could not be saved.` : `Created ${row.identifier ?? d.title}`);
        return true;
      }
      versions.current.set(row.id, row.version);
      store.current.upsert({ ...row, sort_key: String(Date.now()) });
      const patch = { ...extra, ...(row.status !== d.status ? { status: d.status } : {}) };
      if (Object.keys(patch).length) {
        store.current.update(row.id, patch);
        // Await the follow-up PATCH here (not push()) so a failure is reported instead of being overwritten by the "Created" toast.
        const r = await apiPatch(api.slug, row, row.version, patch);
        if (r.issue) {
          versions.current.set(row.id, r.issue.version);
          const local = store.current.list().find((x) => x.id === row.id);
          store.current.upsert(r.kind === 'ok' && local ? { ...local, version: r.issue.version, identifier: r.issue.identifier } : { ...r.issue, sort_key: row.sort_key });
        }
        if (r.kind !== 'ok') patchFailed = true;
      }
      made = store.current.list().find((x) => x.id === row.id);
    } else {
      made = store.current.create({ title: d.title, description: d.description, status: d.status, priority: d.priority, assignee_id: d.assignee_id });
      const rest = { ...(d.label_ids.length ? { label_ids: d.label_ids } : {}), ...(d.project_id ? { project_id: d.project_id } : {}) };
      if (made && Object.keys(rest).length) store.current.update(made.id, rest);
      made = made && store.current.list().find((x) => x.id === made!.id);
    }
    sync();
    if (view === 'cycles' || view === 'projects') setView('list');
    if (made && activeCount(filters) > 0 && applyFilters([made], filters).length === 0) setFilters(emptyFilters());
    if (made) setSelId(made.id);
    setToast(patchFailed ? `Created ${made?.identifier ?? d.title}, but some properties could not be saved.` : `Created ${made?.identifier ?? d.title}`);
    return true;
  }
  // Mock mode: the current user is the first mock user. API mode needs the session user + members API (same gap as the A picker).
  function assignToMe() {
    const id = currentIdRef.current; if (!id) return;
    if (api) {
      const meId = nlPeople.me; if (!meId) { setToast(nlPeopleLoaded ? 'No session user.' : 'Loading members…'); return; }
      store.current.update(id, { assignee_id: meId }); push(id, { assignee_id: meId }); sync(); setToast(`Assigned to ${findPerson(people, meId)?.name ?? 'you'}`); return;
    }
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
  // Delete (# / Delete / Backspace / bar button): confirm, then soft-delete the selection. API mode: DELETE /issues/<id> (If-Match);
  // rows the server refuses are put back.
  const [confirmDel, setConfirmDel] = useState<string[] | null>(null);
  const [undoDel, setUndoDel] = useState<{ msg: string; items: Issue[] } | null>(null);
  const confirmTarget = confirmDel?.length === 1 ? store.current.list().find((x) => x.id === confirmDel[0]) : undefined;
  // Delete only acts in the list and board, on an explicit target: the multi-selection, or the cursor row the user moved to (no fallback to the first row).
  function askDelete() {
    if (view !== 'list' && view !== 'board') return;
    if (readOnly) { setToast('Guests have read-only access.'); return; }
    const explicit = multiRef.current.length ? multiRef.current : selId && ordered.some((i) => i.id === selId) ? [selId] : [];
    const ids = explicit.filter((id) => store.current.list().some((x) => x.id === id && !x.deleted_at));
    if (ids.length) setConfirmDel(ids);
    else setToast('Select an issue first (J/K to move, X to select).');
  }
  async function undoDelete() {
    const u = undoDel; if (!u) return;
    setUndoDel(null); setToast(null);
    let failed = 0;
    for (const it of u.items) {
      if (api) {
        const r = await detailApi(api.slug).restore(it.id);
        if (!r.ok) { failed += 1; continue; }
        const row = (r as { data?: unknown }).data as Partial<Issue> | null | undefined;
        store.current.upsert({ ...it, ...(row && typeof row === 'object' ? row : {}), deleted_at: null });
        if (row && typeof row.version === 'number') versions.current.set(it.id, row.version);
      } else store.current.upsert({ ...it, deleted_at: null });
    }
    sync();
    setToast(failed ? `Could not restore ${failed} of ${u.items.length} issues` : `${u.items.length} issue${u.items.length === 1 ? '' : 's'} restored`);
  }
  async function deleteIssues(ids: string[]) {
    const items = ids.map((id) => store.current.list().find((x) => x.id === id)).filter((x): x is Issue => !!x);
    const keep = ordered.filter((i) => !ids.includes(i.id));
    const at = ordered.findIndex((i) => ids.includes(i.id));
    for (const it of items) store.current.remove(it.id);
    setMulti([]); setSelId(keep[Math.min(Math.max(at, 0), keep.length - 1)]?.id ?? '');
    sync();
    let failed = 0;
    const gone: Issue[] = [];
    if (api) {
      await Promise.all(ids.map((id) => chains.current.get(id)).filter(Boolean));
      const client = detailApi(api.slug);
      await Promise.all(items.map(async (it) => {
        const r = await client.remove(it.id, versions.current.get(it.id) ?? it.version);
        if (r.ok) { versions.current.delete(it.id); gone.push(it); }
        else { failed += 1; store.current.upsert(it); }
      }));
      sync();
    } else gone.push(...items);
    const done = items.length - failed;
    const msg = failed ? `Deleted ${done} of ${items.length}, ${failed} could not be deleted` : `${done} issue${done === 1 ? '' : 's'} deleted`;
    setToast(msg);
    setUndoDel(gone.length ? { msg, items: gone } : null);
  }

  function selectAll() { if (view !== 'list' && view !== 'board') return; const list = orderedRef.current; setMulti(list.map((i) => i.id)); if (list.length) setSelId(currentIdRef.current ?? list[0]!.id); }
  function toggleSelect(id: string | undefined) { if (id) setMulti((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id])); }
  // Shift+J/K: move the cursor and add both ends to the selection.
  function extend(dir: 1 | -1) {
    const list = orderedRef.current; if (!list.length) return;
    const idx = Math.max(0, list.findIndex((i) => i.id === currentIdRef.current));
    const n = Math.min(Math.max(idx + dir, 0), list.length - 1);
    setMulti((m) => Array.from(new Set([...m, list[idx]!.id, list[n]!.id])));
    setSelId(list[n]!.id);
  }
  // Sidebar team row shows the real team (e.g. "Demo"), not the workspace name again.
  const [teamList, setTeamList] = useState<Team[]>([]); const [teamName, setTeamName] = useState('Team');
  useEffect(() => {
    if (!api) return;
    let live = true;
    void listTeams(api.slug).then((ts) => { if (live) setTeamList(ts); const t = ts.find((x) => x.id === api.teamId) ?? ts[0]; if (live && t) setTeamName(t.name); }).catch(() => { /* keep fallback */ });
    return () => { live = false; };
  }, [api?.slug, api?.teamId]); // eslint-disable-line react-hooks/exhaustive-deps
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
    { id: 'status', label: multi.length > 1 ? `Cycle status of ${multi.length} selected` : 'Cycle status of selected issue', run: cycleStatus },
    { id: 'set-status', label: 'Set status…', hint: 'S', run: () => setTimeout(() => openPick('status'), 0) },
    { id: 'select-all', label: 'Select all issues', hint: '⌘A', run: selectAll },
    { id: 'delete', label: multi.length > 1 ? `Delete ${multi.length} selected issues…` : 'Delete selected issue…', hint: '#', run: () => setTimeout(askDelete, 0) },
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
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'error'>('idle'); // server search state, API mode
  const issuesRef = useRef<Issue[]>([]);
  issuesRef.current = allIssues;
  useEffect(() => {
    const term = q.trim();
    if (!palette || term.length < MIN_QUERY) { setHits([]); setSearchState('idle'); return; }
    const ctl = new AbortController();
    if (api) setSearchState('loading');
    const t = setTimeout(async () => {
      if (api) {
        const r = await searchApi(api.slug, term, { limit: 8, signal: ctl.signal });
        if (ctl.signal.aborted) return;
        setHits(r?.items ?? []); setSearchState(r ? 'idle' : 'error');
      } else setHits(searchLocal(issuesRef.current, term, undefined, 8).items);
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
  // Like Linear: once the query matches issues, hits come first; an empty query keeps actions on top.
  const baseResults: Cmd[] = hitCmds.length ? [...hitCmds, ...matched, ...allCmd] : [...matched, ...allCmd];
  // Natural-language action: an extra row next to the search results, never a replacement.
  const nl = q.trim().length >= 4 && !readOnly ? (api ? parseNlCommand(q, nlPeople.users, LABELS, nlPeople.me, { peopleLoading: !nlPeopleLoaded }) : parseNlCommand(q, USERS, LABELS, USERS[0]!.id)) : null;
  // A status-only phrase is already covered by the built-in 'Move to …' commands: no duplicate NL row.
  const nlStatusOnly = !!nl && !nl.blocked && Object.keys(nl.patch).every((k) => k === 'status');
  // Render-time: use state, not targetIds() (multiRef is declared further down: calling it here is a TDZ crash).
  const nlIds = nl && !nlStatusOnly ? (multi.length ? multi : current?.id ? [current.id] : []) : [];
  const nlCmd: Cmd[] = nl?.blocked && nlIds.length ? [{ id: 'nl', label: nlLabel(nl, nlIds.length), disabled: true, run: () => {} }] : nl && nlIds.length ? [{ id: 'nl', label: nlLabel(nl, nlIds.length), hint: '↵', run: () => {
    const { add_label_ids, assignee_id, ...rest } = nl.patch;
    for (const id of nlIds) {
      const cur = store.current.list().find((x) => x.id === id); if (!cur) continue;
      const local: Record<string, unknown> = { ...rest };
      const remote: Record<string, unknown> = { ...rest };
      if (assignee_id !== undefined) { local.assignee_id = assignee_id; if (assignee_id === null) remote.assignee_id = null; else if (isUuid(assignee_id)) remote.assignee_id = assignee_id; }
      if (add_label_ids?.length) { const label_ids = [...new Set([...cur.label_ids, ...add_label_ids])]; local.label_ids = label_ids; remote.label_ids = label_ids; }
      if (rest.status !== undefined && rest.status !== cur.status) store.current.move(id, rest.status, null);
      store.current.update(id, local);
      if (Object.keys(remote).length) push(id, remote);
    }
    sync(); if (nlIds.length === 1) setSelId(nlIds[0]!); } }] : [];
  // Only an explicit leading verb puts the action first; otherwise ('fix for Ada') search hits keep Enter.
  const nlFirst = /^\s*(assign|unassign|move|mark|set|label|prioriti[sz]e)\b/i.test(q);
  const results: Cmd[] = nlFirst && !nl?.blocked ? [...nlCmd, ...baseResults] : [...baseResults, ...nlCmd];
  // Keep the active row visible while arrowing through a long, sectioned list.
  const activeId = results[pi]?.id;
  // No hit and no command: one 'No results' line with the single 'Search all' row under it (no separate group).
  const noResults = api && q.trim().length >= MIN_QUERY && searchState === 'idle' && hits.length === 0 && matched.length === 0;
  useEffect(() => { if (palette && activeId) document.getElementById(`pc-${activeId}`)?.scrollIntoView({ block: 'nearest' }); }, [palette, activeId]);
  const actions = useRef({ askDelete, selectAll, reorder, create, cycleStatus, closePalette, openPalette, openPick, toggleSelect, extend, setView, setHelp, clearMulti: () => setMulti([]) });
  const paletteOpen = useRef(false);
  const helpOpen = useRef(false);
  const readOnlyRef = useRef(readOnly);
  useEffect(() => { orderedRef.current = ordered; currentIdRef.current = current?.id; actions.current = { askDelete, selectAll, reorder, create, cycleStatus, closePalette, openPalette, openPick, toggleSelect, extend, setView, setHelp, clearMulti: () => setMulti([]) }; helpOpen.current = help; paletteOpen.current = palette; multiRef.current = multi; readOnlyRef.current = readOnly; });
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
      if (newOpen.current) return; // the New issue modal owns the keyboard
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); if (paletteOpen.current) actions.current.closePalette(); else actions.current.openPalette(); return;
      }
      const t = e.target as HTMLElement;
      if (isTypingTarget(t)) {
        if (e.key === 'Escape' && paletteOpen.current) actions.current.closePalette();
        return;
      }
      if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); actions.current.reorder(e.key === 'ArrowUp' ? -1 : 1); return; }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a' && !document.querySelector('main[data-view=inbox]')) { e.preventDefault(); actions.current.selectAll(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (helpOpen.current && e.key !== 'Escape') return;
      // Bare modifier / navigation keydowns (Shift, Control, Tab...) must not reset a pending g sequence.
      if (e.key.length > 1 && !['Enter', 'Escape', 'Delete', 'Backspace'].includes(e.key)) return;
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
        case 'status': e.preventDefault(); actions.current.openPick('status'); break;
        case 'delete': case 'delete-key': case 'delete-bs': e.preventDefault(); actions.current.askDelete(); break;
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

  const who = (id: string | null) => findPerson(people, id);
  const inboxLookup = { person: (id: string | null) => who(id)?.name, label: (id: string) => LABELS.find((x) => x.id === id), project: (id: string | null) => (id ? PROJECTS.find((x) => x.id === id)?.name : undefined) };
  const assignee = (i: Issue) => { const u = who(i.assignee_id); return u ? <span title={u.name} className='av-wrap'><Avatar initials={u.initials} hue={u.hue} /></span> : <span className='av-wrap' title='Unassigned'><UnassignedIcon /></span>; };
  const select = (i: Issue, openPanel: boolean) => { setSelId(i.id); if (openPanel) setOpen(true); };

  const row = (i: Issue) => (
    <div key={i.id} role='option' data-id={i.id} tabIndex={current?.id === i.id ? 0 : -1} aria-selected={current?.id === i.id} data-multi={multi.includes(i.id) || undefined} className={`row${dragId === i.id ? ' dragging' : ''}${overKey === i.id ? ' over' : ''}`} {...dragProps(i)} onClick={() => select(i, true)}>
      {!readOnly && <span className={`rowsel${multi.includes(i.id) ? ' on' : ''}`} aria-hidden='true' data-testid={`select-${i.identifier ?? i.id}`} onClick={(e) => { e.stopPropagation(); toggleSelect(i.id); }} />}
      {shown('priority') && <PriorityIcon priority={i.priority} />}
      {shown('id') && <span className='id'>{i.identifier ?? i.id}</span>}
      {shown('status') && <StatusIcon status={i.status} />}
      <span className='title'>{i.title}</span>
      {subBadge(i)}
      {shown('labels') && <span className='labels'>{(() => { const { shown: vis, hidden } = fitLabels(i.label_ids.flatMap((l) => { const lb = LABELS.find((x) => x.id === l); return lb ? [lb] : []; })); return <>{vis.map((lb) => <span key={lb.id} className={`chip ${lb.hue}`}>{lb.name}</span>)}{hidden.length > 0 && <Tooltip label={hidden.map((h) => h.name).join(', ')}><span className='chip chip-more' tabIndex={0} aria-label={`${hidden.length} more labels: ${hidden.map((h) => h.name).join(', ')}`}>+{hidden.length}</span></Tooltip>}</>; })()}</span>}
      {shown('project') && <span className='proj-col'>{(() => { const pj = i.project_id ? PROJECTS.find((x) => x.id === i.project_id) : null; return pj ? <span className='chip proj' title={pj.name}><PropIcon name='project' /><span className='proj-name'>{pj.name}</span></span> : null; })()}</span>}
      {shown('created') && <span className='date' title={fmtDate(i.created_at)}>{relDate(i.created_at)}</span>}
      {shown('assignee') && assignee(i)}
    </div>
  );
  const card = (i: Issue, pos?: number, size?: number) => (
    <div key={i.id} role='option' aria-posinset={pos} aria-setsize={size} data-id={i.id} tabIndex={current?.id === i.id ? 0 : -1} aria-selected={current?.id === i.id} data-multi={multi.includes(i.id) || undefined} className={`card${dragId === i.id ? ' dragging' : ''}${overKey === i.id ? ' over' : ''}`} {...dragProps(i)} onClick={() => select(i, true)}>
      <div className='card-top'><span className='id'>{i.identifier ?? i.id}</span>{assignee(i)}</div>
      <div className='card-title'>{i.title}</div>
      <div className='card-meta'>{subBadge(i)}<span className='card-prio' data-none={i.priority === 0 || undefined} title={PRIORITY_LABEL[i.priority]}><PriorityIcon priority={i.priority} /></span>{i.label_ids.map((l) => { const lb = LABELS.find((x) => x.id === l); return lb ? <span key={l} className={`chip ${lb.hue}`}>{lb.name}</span> : null; })}</div>
    </div>
  );

  return (
    <div className='shell'>
      <aside className='side' aria-label='Sidebar'>
        <div className='side-head'>
          <WorkspaceSwitcher slug={api?.slug ?? null} people={nlPeople} />
          <button className='side-icbtn' onClick={openPalette} aria-label='Search' title='Search (⌘K)' aria-keyshortcuts='Meta+K Control+K'><SideIcon name='search' /></button>
          {!readOnly && <button className='side-icbtn compose' onClick={() => create()} aria-label='New issue' title='New issue (C)' aria-keyshortcuts='C'><SideIcon name='compose' /></button>}
        </div>
        <nav aria-label='Primary'>
          <a className={`side-link${view === 'inbox' ? ' active' : ''}`} aria-current={view === 'inbox' ? 'page' : undefined} href='#inbox' onClick={(e) => { e.preventDefault(); setView('inbox'); }}><SideIcon name='inbox' /><span>Inbox</span>{unreadCount > 0 && <span className='badge' data-testid='inbox-badge' aria-label={`${unreadCount} unread notifications`}>{unreadCount > 99 ? '99+' : unreadCount}</span>}</a>
          <a className='side-link' href='#my-issues' onClick={(e) => e.preventDefault()}><SideIcon name='mine' /><span>My issues</span></a>
          <a className='side-link' href='#views' onClick={(e) => e.preventDefault()}><SideIcon name='views' /><span>Views</span></a>
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
          <TeamSection name={teamName}>
          <a className={`side-link sub${view !== 'cycles' && view !== 'projects' && view !== 'inbox' ? ' active' : ''}`} aria-current={view !== 'cycles' && view !== 'projects' && view !== 'inbox' ? 'page' : undefined} href='#issues' onClick={(e) => { e.preventDefault(); if (view === 'cycles' || view === 'projects' || view === 'inbox') setView('list'); }}><SideIcon name='issues' /><span>Issues</span>{hint('go-issues') && <kbd className='side-kbd' aria-hidden='true'>{hint('go-issues')}</kbd>}</a>
          <a className={`side-link sub${view === 'cycles' ? ' active' : ''}`} aria-current={view === 'cycles' ? 'page' : undefined} href='#cycles' onClick={(e) => { e.preventDefault(); setView('cycles'); }}><SideIcon name='cycles' /><span>Cycles</span></a>
          <a className={`side-link sub${view === 'projects' ? ' active' : ''}`} aria-current={view === 'projects' ? 'page' : undefined} href='#projects' onClick={(e) => { e.preventDefault(); setView('projects'); }}><SideIcon name='projects' /><span>Projects</span>{hint('go-projects') && <kbd className='side-kbd' aria-hidden='true'>{hint('go-projects')}</kbd>}</a>
          </TeamSection>
        </nav>
      </aside>
      <main className='main' ref={mainRef} data-view={view}>
        <header className='head'>
          <div className='crumbs'><span>Delos</span><span className='sep'>/</span><h1 className='crumb-title'>{view === 'inbox' ? 'Inbox' : view === 'cycles' ? 'Cycles' : view === 'projects' ? 'Projects' : 'Issues'}</h1><span className='count'>{view === 'inbox' ? unreadCount : view === 'cycles' ? CYCLES.length : view === 'projects' ? PROJECTS.length : issues.length}</span></div>
          {(view === 'list' || view === 'board') && !loadError && allIssues.length > 0 && (
            <div className='vtabs' role='group' aria-label='Issue views'>
              {VIEW_TABS.map((t) => { const on = sameSet(filters.status, t.status); return (
                <button key={t.id} type='button' className='vtab' data-testid={`vtab-${t.id}`} aria-pressed={on} onClick={() => { setActiveViewId(null); setFilters({ ...filters, status: [...t.status] }); }}>{t.label}</button>
              ); })}
            </div>
          )}
          {(view === 'list' || view === 'board') && (
          <div className='switch' role='group' aria-label='View'>
            <button aria-pressed={view === 'list'} onClick={() => setView('list')} title='List'><Icon name='list' /><span>List</span></button>
            <button aria-pressed={view === 'board'} onClick={() => setView('board')} title='Board'><Icon name='board' /><span>Board</span></button>
          </div>
          )}
        </header>
        {view !== 'cycles' && view !== 'projects' && view !== 'inbox' && !loadError && allIssues.length > 0 && (
          <div className='filterbar' role='toolbar' aria-label='Filters'>
            {FILTER_KEYS.filter((k) => filters[k].length > 0).map((k) => (
              <span key={k} className='fseg' data-kind={k}>
                <button id={`fb-${k}`} className='fchip on' aria-label={`${FILTER_LABEL[k]}: ${filterValueLabel(k)}`} aria-haspopup='dialog' aria-expanded={filterPick?.kind === k} aria-pressed='true' onClick={(e) => setFilterPick({ kind: k, rect: e.currentTarget.getBoundingClientRect() })}>
                  <span className='fkey'>{FILTER_LABEL[k]}<span className='fcolon' aria-hidden='true'>:</span></span><span className='fval'>{' '}{filterValueLabel(k)}</span>
                </button>
                <button type='button' className='fx' aria-label={`Remove ${FILTER_LABEL[k].toLowerCase()} filter`} title='Remove filter' onClick={() => { setActiveViewId(null); setFilters({ ...filters, [k]: [] }); }}><Icon name='x' size={12} /></button>
              </span>
            ))}
            <div className='fwrap'>
              <button id='fb-add' className='tb-btn' aria-haspopup='menu' aria-expanded={tbMenu === 'filter'} onClick={() => setTbMenu(tbMenu === 'filter' ? null : 'filter')}><Icon name='filter' /><span>Filter</span></button>
              {tbMenu === 'filter' && <FilterMenu filters={filters} onClose={() => { setTbMenu(null); document.getElementById('fb-add')?.focus(); }} onPick={(k) => { const r = document.getElementById('fb-add')?.getBoundingClientRect() ?? null; setTbMenu(null); setFilterPick({ kind: k, rect: r }); }} />}
            </div>
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
            {view === 'list' && (
              <div className='tb-right'>
                <button id='fb-display' className='tb-btn' aria-haspopup='dialog' aria-expanded={tbMenu === 'display'} onClick={() => setTbMenu(tbMenu === 'display' ? null : 'display')}><Icon name='display' /><span>Display</span></button>
                {tbMenu === 'display' && (
                  <div className='tb-menu display' role='dialog' aria-label='Display options' onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setTbMenu(null); document.getElementById('fb-display')?.focus(); } }}>
                    <div className='dp-row'><span className='dp-k'><Icon name='list' />Grouping</span><DisplayPick label='Grouping' autoFocus value={grouping} labels={GROUPING_LABEL} onChange={setGrouping} /></div>
                    <div className='dp-row'><span className='dp-k'><Icon name='views' />Ordering</span><DisplayPick label='Ordering' value={ordering} labels={ORDERING_LABEL} onChange={setOrdering} /></div>
                    <div className='dp-sep' role='separator' />
                    <label className='dp-row dp-switch'><span className='dp-k'>Show empty groups</span><input type='checkbox' role='switch' checked={showEmpty} disabled={grouping === 'none'} onChange={(e) => setShowEmpty(e.target.checked)} /><i aria-hidden='true' /></label>
                    <div className='dp-sep' role='separator' />
                    <div className='dp-h' id='dp-props'>Display properties</div>
                    <div className='dp-props' role='group' aria-labelledby='dp-props'>{(Object.keys(DISPLAY_PROP_LABEL) as DisplayProp[]).map((k) => <button key={k} type='button' className={`dp-chip${shown(k) ? ' on' : ''}`} aria-pressed={shown(k)} onClick={() => toggleProp(k)}>{DISPLAY_PROP_LABEL[k]}</button>)}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {loadError ? (
          <div className='state error' role='alert'>
            <p>{loadError}. Check your connection and try again.</p>
            <button className='btn' onClick={() => router.refresh()}>Retry</button>
          </div>
        ) : allIssues.length === 0 ? (
          <EmptyState icon='issues' title='No issues yet' hint='Issues track the work your team is doing. Create one to get started.'
            action={!readOnly && <button className='btn' data-variant='primary' onClick={() => create()}>Create issue <kbd>C</kbd></button>} />
        ) : view === 'inbox' ? (
          <Inbox client={inboxClient} refreshKey={rtTick} getIssue={getIssue} lookup={inboxLookup} onUnread={setUnreadCount} onOpenIssue={(id) => { setView('list'); setSelId(id); }} />
        ) : view === 'projects' && detailId && api ? (
          <ProjectDetail refreshKey={rtTick} slug={api.slug} projectId={detailId} canWrite={!readOnly} onBack={() => setDetailId(null)} onViewIssues={(id) => { setDetailId(null); goToProject(id); }}
            issues={allIssues.filter((i) => i.project_id === detailId).map((i) => ({ id: i.id, identifier: i.identifier ?? i.id, title: i.title, done: i.status === 'done' || i.status === 'canceled' }))}
            leadName={who(PROJECTS.find((p) => p.id === detailId)?.lead_id ?? null)?.name ?? null}
            onOpenIssue={(id) => { setDetailId(null); setView('list'); setSelId(id); }} />
        ) : view === 'projects' ? (
          <ProjectsList people={people} projects={PROJECTS} issues={allIssues} today={today} canOpen={!!api} onOpen={setDetailId} onViewIssues={goToProject} />
        ) : view === 'cycles' ? (
          <CyclesList cycles={CYCLES} issues={allIssues} today={today} slug={api?.slug ?? null} onViewIssues={(id) => { setFilters({ ...emptyFilters(), cycle: [id] }); setView('list'); }} />
        ) : issues.length === 0 ? (
          <EmptyState icon='filter' title='No issues match these filters.' hint='Try removing a filter or broadening your search.'
            action={<button className='btn' onClick={() => setFilters(emptyFilters())}>Clear filters</button>} />
        ) : view === 'list' ? (
          <div className='scroll'>
            {groups.map(({ key, status, items }) => {
              const s = status as Status | null;
              const shut = collapsed.has(key);
              return (
                <section key={key} className={`group${s && overKey === `z-${s}` ? ' over-zone' : ''}`} aria-labelledby={`g-${key}`} {...(s ? zoneProps(s) : {})}>
                  <h2 id={`g-${key}`}>
                    <button className='gh-toggle' aria-expanded={!shut} aria-controls={`gl-${key}`} onClick={() => toggleGroup(key)}>{s && <StatusIcon status={s} />}<span>{s ? STATUS_LABEL[s] : 'All issues'}</span><span className='count'>{items.length}</span><i className='chev' aria-hidden='true'>▾</i></button>
                    {s && !readOnly && <button className='gh-add' aria-label={`Add issue to ${STATUS_LABEL[s]}`} onClick={() => create(s)}><Icon name='plus' /></button>}
                  </h2>
                  {!shut && <div id={`gl-${key}`} role='listbox' aria-labelledby={`g-${key}`}>{items.map(row)}</div>}
                </section>
              );
            })}
          </div>
        ) : (
          <div className='board'>
            {STATUSES.filter((s) => !hiddenCols.has(s)).map((s) => (
              <Column key={s} status={s} items={issues.filter((i) => i.status === s)} renderCard={card} selectedId={current?.id} overZone={overKey === `z-${s}`} zone={zoneProps(s)} onAdd={readOnly ? undefined : create} onHide={(st) => setHiddenCols((h) => toggleIn(h, st, true))} folded={foldedCols.has(s)} onFold={(st) => setFoldedCols((f) => toggleIn(f, st))} />
            ))}
            {hiddenCols.size > 0 && (
              <aside className='board-hidden' aria-label='Hidden columns'>
                <h3>Hidden columns</h3>
                {STATUSES.filter((s) => hiddenCols.has(s)).map((s) => (
                  <button key={s} type='button' className='board-hidden-row' aria-label={`Show ${STATUS_LABEL[s]} column`} onClick={() => setHiddenCols((h) => toggleIn(h, s, false))}>
                    <StatusIcon status={s} /><span>{STATUS_LABEL[s]}</span><span className='count'>{issues.filter((i) => i.status === s).length}</span>
                  </button>
                ))}
              </aside>
            )}
            <div className='board-end' aria-hidden='true' />
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
      {multi.length > 1 && !readOnly && <SelectionBar count={multi.length} canUndo={!!undo} openKind={pick && pick.ids.length > 1 ? (pick.kind as BulkKind) : null} onAction={(k, r) => openPick(k, r)} onUndo={() => void undoBulk()} onClear={() => setMulti([])} onDelete={askDelete} />}
      <ConfirmDialog open={!!confirmDel} title={confirmDel?.length === 1 ? `Delete ${confirmTarget ? (confirmTarget.identifier ?? confirmTarget.id) : 'issue'}?` : `Delete ${confirmDel?.length ?? 0} issues?`} confirmLabel='Delete' destructive onCancel={() => setConfirmDel(null)} onConfirm={() => { const ids = confirmDel ?? []; setConfirmDel(null); void deleteIssues(ids); }}>
        {confirmDel?.length === 1 && confirmTarget && <p>{confirmTarget.title}</p>}Use Undo right after, or the issue page, to restore.
      </ConfirmDialog>
      {multi.length > 0 && <div className='toast' role='status'>{multi.length} selected, Esc to clear</div>}
      {help && (
        <div className='overlay' onClick={() => setHelp(false)}>
          <div className='palette' role='dialog' aria-modal='true' aria-label='Keyboard shortcuts' onClick={(e) => e.stopPropagation()} ref={(el) => el?.focus()} tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setHelp(false); } else if (e.key === 'Tab') e.preventDefault(); /* focus trap: the dialog is the only focusable element */ }}>
            {(['Issues', 'Navigation', 'Selection', 'General'] as const).map((g) => (
              <section key={g}><h3>{g}</h3><ul>{SHORTCUTS.filter((d) => d.group === g && !d.hidden).map((d) => <li key={d.id}><span>{d.label}</span><kbd>{formatKeys(d.keys)}</kbd></li>)}</ul></section>
            ))}
          </div>
        </div>
      )}
      <NewIssueModal open={newIssue !== null} {...(newIssue?.status ? { initialStatus: newIssue.status } : {})} people={people} labels={LABELS} projects={PROJECTS} teams={teamList} teamId={api?.teamId ?? ''} onClose={() => setNewIssue(null)} onSubmit={submitNew} />
      {toast && <div className='toast' role='status' onClick={() => setToast(null)}>{toast}{undoDel && toast === undoDel.msg && <button type='button' className='toast-undo' onClick={(e) => { e.stopPropagation(); void undoDelete(); }}>Undo</button>}</div>}
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
                else if (e.key === 'Enter') { const c = results[pi]; if (c?.disabled) return; closePalette(); c?.run(); }
              }}
            />
            <ul id='palette-list' role='listbox' aria-label='Commands'>
              {noResults && <li role='presentation' data-testid='palette-no-results' className='pal-empty pal-noresults'>No results for “{q.trim()}”</li>}
              {results.map((c, idx) => (
                <Fragment key={c.id}>{!(noResults && c.id === 'search-all') && (idx === 0 || paletteGroup(results[idx - 1]!.id) !== paletteGroup(c.id)) && <li role='presentation' className='pal-group'>{paletteGroup(c.id)}</li>}
                <li id={`pc-${c.id}`} className={c.id === 'nl' ? (c.disabled ? 'nl-action is-disabled' : 'nl-action') : undefined} role='option' aria-selected={idx === pi} aria-disabled={c.disabled || undefined} onClick={() => { if (c.disabled) return; closePalette(); c.run(); }}><span className='pal-ic' aria-hidden='true'>{c.hit?.kind === 'issue' && c.hit.status && (STATUSES as readonly string[]).includes(c.hit.status) ? <StatusIcon status={c.hit.status as Status} /> : paletteIcon(c.id)}</span><span className='pal-label'>{c.hit ? <>{c.hit.identifier && <b className='hit-id'>{c.hit.identifier} </b>}{c.hit.kind === 'comment' ? snippetParts(c.hit.snippet).map((p, k) => (p.mark ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>)) : markTerm(c.hit.title, q)}</> : c.label}</span>{c.hint && <span className='pal-keys'>{c.hint.split(' ').map((k, j) => <kbd key={j}>{k}</kbd>)}</span>}</li></Fragment>
              ))}
              {api && q.trim().length >= MIN_QUERY && searchState === 'loading' && <li role='option' aria-selected='false' aria-disabled='true' data-testid='palette-searching'>Searching…</li>}
              {api && q.trim().length >= MIN_QUERY && searchState === 'error' && <li role='option' aria-selected='false' aria-disabled='true' data-testid='palette-search-error'>Search failed. Try again.</li>}
              {results.length === 0 && !(api && q.trim().length >= MIN_QUERY) && <li role='option' aria-selected='false' aria-disabled='true' className='pal-empty'>No matching command</li>}
            </ul>
            <div className='palette-foot'><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> run</span><span><kbd>esc</kbd> close</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

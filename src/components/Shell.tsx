'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUSES, STATUS_LABEL, PRIORITY_LABEL, USERS, MOCK_META, fmtDate, type Issue, type Meta, type Status } from '@/lib/issues';
import { Avatar, Icon, PriorityIcon, StatusIcon } from '@/components/icons';
import { fuzzyFilter } from '@/lib/fuzzy';
import { createStore } from '@/lib/mock-api';
import { createIssue as apiCreate, isUuid, patchIssue as apiPatch } from '@/lib/api-client';
import { visibleWindow, scrollToIndex } from '@/lib/virtual';
import { Picker, type PickOption } from '@/components/Picker';
import { FILTER_KEYS, NONE, activeCount, applyFilters, cycleBucket, emptyFilters, writeFilters, type FilterKey, type Filters, type CycleBucket } from '@/lib/filters';

type View = 'list' | 'board' | 'cycles';
const FILTER_LABEL: Record<FilterKey, string> = { status: 'Status', assignee: 'Assignee', label: 'Label', project: 'Project', cycle: 'Cycle' };
const BUCKETS: { id: CycleBucket; title: string }[] = [{ id: 'active', title: 'Active' }, { id: 'upcoming', title: 'Upcoming' }, { id: 'past', title: 'Past' }];
type PickKind = 'priority' | 'assignee' | 'label';
interface Cmd { id: string; label: string; hint?: string; run: () => void }

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
  const selIdx = selectedId ? items.findIndex((i) => i.id === selectedId) : -1;
  useEffect(() => {
    const el = ref.current; if (!el || selIdx < 0) return;
    const next = scrollToIndex(selIdx, el.scrollTop, el.clientHeight || vh);
    if (next !== el.scrollTop) { el.scrollTop = next; setTop(next); }
  }, [selIdx, vh]);
  const w = visibleWindow(items.length, top, vh);
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

export function Shell({ initialIssues, loadError = null, initialFilters = emptyFilters(), today, meta = MOCK_META, api = null }: { initialIssues: Issue[]; loadError?: string | null; initialFilters?: Filters; today: string; meta?: Meta; api?: { slug: string; teamId: string } | null }) {
  const router = useRouter();
  const { labels: LABELS, cycles: CYCLES, projects: PROJECTS } = meta;
  const [toast, setToast] = useState<string | null>(null);
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
      if (r.issue) { versions.current.set(id, r.issue.version); store.current.upsert({ ...r.issue, sort_key: prev.sort_key }); sync(); }
      if (r.kind === 'conflict') setToast('Issue modified elsewhere. Reloaded the latest version.');
      else if (r.kind === 'error') setToast('Could not save the change. Reloaded the latest version.');
    };
    chains.current.set(id, (chains.current.get(id) ?? Promise.resolve()).then(run, run));
  }
  const [filters, setFiltersState] = useState<Filters>(initialFilters);
  const [filterPick, setFilterPick] = useState<{ kind: FilterKey; rect: DOMRect | null } | null>(null);
  const issues = useMemo(() => applyFilters(allIssues, filters), [allIssues, filters]);
  // Filters live in the URL: replaceState keeps other params (seed, state) and does not refetch.
  function setFilters(f: Filters) {
    setFiltersState(f);
    const qs = writeFilters(window.location.search, f);
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
  }
  function toggleFilter(kind: FilterKey, id: string) {
    const cur = filters[kind];
    setFilters({ ...filters, [kind]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  }
  function filterOptions(kind: FilterKey): PickOption[] {
    const on = (id: string) => filters[kind].includes(id);
    if (kind === 'status') return STATUSES.map((st) => ({ id: st, label: STATUS_LABEL[st], checked: on(st), lead: <StatusIcon status={st} /> }));
    if (kind === 'assignee') return [{ id: NONE, label: 'Unassigned', checked: on(NONE), lead: <span className='av av-none' aria-hidden='true' /> }, ...USERS.map((u) => ({ id: u.id, label: u.name, checked: on(u.id), lead: <Avatar initials={u.initials} hue={u.hue} /> }))];
    if (kind === 'label') return LABELS.map((l) => ({ id: l.id, label: l.name, checked: on(l.id), lead: <span className={`chip ${l.hue}`} aria-hidden='true'>&nbsp;</span> }));
    if (kind === 'project') return [{ id: NONE, label: 'No project', checked: on(NONE) }, ...PROJECTS.map((p) => ({ id: p.id, label: p.name, checked: on(p.id) }))];
    return [{ id: NONE, label: 'No cycle', checked: on(NONE) }, ...CYCLES.map((c) => ({ id: c.id, label: c.name, checked: on(c.id) }))];
  }
  function filterValueLabel(kind: FilterKey): string {
    const o = filterOptions(kind).filter((x) => x.checked);
    return o.length === 1 ? o[0]!.label : `${o.length} selected`;
  }
  const [view, setView] = useState<View>('list');
  const [selId, setSelId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [q, setQ] = useState('');
  const [pi, setPi] = useState(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [pick, setPick] = useState<{ kind: PickKind; id: string; rect: DOMRect | null } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  // Test hook, not product behaviour: e2e tests wait for html[data-ready] so key presses
  // are not sent before hydration has attached the handlers.
  useEffect(() => { document.documentElement.dataset.ready = '1'; return () => { delete document.documentElement.dataset.ready; }; }, []);

  const ordered = useMemo(() => STATUSES.flatMap((s) => issues.filter((i) => i.status === s)), [issues]);
  const current = ordered.find((i) => i.id === selId) ?? ordered[0];
  const orderedRef = useRef(ordered);
  const currentIdRef = useRef<string | undefined>(current?.id);

  function cycleStatus() {
    if (!current) return;
    const next = STATUSES[(STATUSES.indexOf(current.status) + 1) % STATUSES.length] as Status;
    store.current.update(current.id, { status: next });
    sync();
    push(current.id, { status: next });
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
  function openPick(kind: PickKind) {
    const id = currentIdRef.current; if (!id) return;
    const rect = document.querySelector<HTMLElement>(`[data-id="${id}"]`)?.getBoundingClientRect() ?? null;
    setPick({ kind, id, rect });
  }
  function closePick() {
    const id = pick?.id; setPick(null);
    setTimeout(() => document.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus(), 0);
  }
  function applyPick(optId: string) {
    if (!pick) return;
    const cur = store.current.list().find((x) => x.id === pick.id); if (!cur) return;
    if (pick.kind === 'priority') { store.current.update(cur.id, { priority: Number(optId) as Issue['priority'] }); push(cur.id, { priority: Number(optId) }); sync(); closePick(); }
    else if (pick.kind === 'assignee') { store.current.update(cur.id, { assignee_id: optId === 'none' ? null : optId }); if (isUuid(optId)) push(cur.id, { assignee_id: optId }); else if (optId === 'none') push(cur.id, { assignee_id: null }); /* mock USERS ids are not UUIDs: local only until GET members exists */ sync(); closePick(); }
    else { const label_ids = cur.label_ids.includes(optId) ? cur.label_ids.filter((l) => l !== optId) : [...cur.label_ids, optId]; store.current.update(cur.id, { label_ids }); push(cur.id, { label_ids }); sync(); }
  }
  function pickOptions(): PickOption[] {
    const cur = pick && allIssues.find((x) => x.id === pick.id);
    if (!pick || !cur) return [];
    if (pick.kind === 'priority') return PRIORITY_LABEL.map((l, n) => ({ id: String(n), label: l, checked: cur.priority === n, lead: <PriorityIcon priority={n as Issue['priority']} /> }));
    if (pick.kind === 'assignee') return [{ id: 'none', label: 'Unassigned', checked: cur.assignee_id === null, lead: <span className='av av-none' aria-hidden='true' /> }, ...USERS.map((u) => ({ id: u.id, label: u.name, checked: cur.assignee_id === u.id, lead: <Avatar initials={u.initials} hue={u.hue} /> }))];
    return LABELS.map((l) => ({ id: l.id, label: l.name, checked: cur.label_ids.includes(l.id), lead: <span className={`chip ${l.hue}`} aria-hidden='true'>&nbsp;</span> }));
  }
  function create() {
    if (api) {
      void apiCreate(api.slug, api.teamId, 'New issue').then((row) => {
        if (!row) { setToast('Could not create the issue.'); return; }
        versions.current.set(row.id, row.version);
        store.current.upsert({ ...row, sort_key: String(Date.now()) });
        sync();
      });
      return;
    }
    store.current.create({ title: 'New issue' });
    sync();
  }
  function openPalette() { returnFocus.current = document.activeElement as HTMLElement | null; setPalette(true); setQ(''); setPi(0); }
  function closePalette() { setPalette(false); const el = returnFocus.current; returnFocus.current = null; if (el && document.contains(el)) setTimeout(() => el.focus(), 0); }

  const commands: Cmd[] = [
    { id: 'create', label: 'Create issue', hint: 'C', run: create },
    { id: 'list', label: 'Go to list view', run: () => setView('list') },
    { id: 'board', label: 'Go to board view', run: () => setView('board') },
    { id: 'cycles', label: 'Go to cycles', run: () => setView('cycles') },
    { id: 'clear-filters', label: 'Clear all filters', run: () => setFilters(emptyFilters()) },
    ...FILTER_KEYS.map((k) => ({ id: `filter-${k}`, label: `Filter by ${FILTER_LABEL[k].toLowerCase()}…`, run: () => setTimeout(() => setFilterPick({ kind: k, rect: document.getElementById(`fb-${k}`)?.getBoundingClientRect() ?? null }), 0) })),
    { id: 'status', label: 'Change status of selected issue', hint: 'S', run: cycleStatus },
    ...STATUSES.map((st) => ({ id: `move-${st}`, label: `Move to ${STATUS_LABEL[st]}`, run: () => { if (currentIdRef.current) moveTo(currentIdRef.current, st, null); } })),
    { id: 'set-priority', label: 'Set priority…', hint: 'P', run: () => setTimeout(() => openPick('priority'), 0) },
    { id: 'set-assignee', label: 'Set assignee…', hint: 'A', run: () => setTimeout(() => openPick('assignee'), 0) },
    { id: 'set-label', label: 'Set label…', hint: 'L', run: () => setTimeout(() => openPick('label'), 0) },
    { id: 'open', label: 'Open selected issue', hint: '↵', run: () => setOpen(true) },
  ];
  const results = fuzzyFilter(commands, q, (c) => c.label);
  const actions = useRef({ reorder, create, cycleStatus, closePalette, openPalette, openPick });
  const paletteOpen = useRef(false);
  useEffect(() => { orderedRef.current = ordered; currentIdRef.current = current?.id; actions.current = { reorder, create, cycleStatus, closePalette, openPalette, openPick }; paletteOpen.current = palette; });
  // Roving focus: when focus is inside the issue collection, follow the selection.
  useEffect(() => {
    const root = mainRef.current;
    if (!root || !current || !root.contains(document.activeElement) || document.activeElement === document.body) return;
    const el = root.querySelector<HTMLElement>(`[data-id="${current.id}"]`);
    if (el && el !== document.activeElement && (document.activeElement as HTMLElement).getAttribute('role') === 'option') el.focus();
  }, [current]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); if (paletteOpen.current) actions.current.closePalette(); else actions.current.openPalette(); return;
      }
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
        if (e.key === 'Escape' && paletteOpen.current) actions.current.closePalette();
        return;
      }
      if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); actions.current.reorder(e.key === 'ArrowUp' ? -1 : 1); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') { setOpen(false); if (paletteOpen.current) actions.current.closePalette(); }
      else if (k === 'j' || k === 'k') {
        const list = orderedRef.current; if (!list.length) return;
        const idx = Math.max(0, list.findIndex((i) => i.id === currentIdRef.current));
        const n = Math.min(Math.max(idx + (k === 'j' ? 1 : -1), 0), list.length - 1);
        setSelId(list[n]!.id);
      }
      else if (e.key === 'Enter') { if (!t.closest('button, a, [role="button"], select')) setOpen(true); }
      else if (k === 'c') { e.preventDefault(); actions.current.create(); }
      else if (k === 's') actions.current.cycleStatus();
      else if (k === 'p') { e.preventDefault(); actions.current.openPick('priority'); }
      else if (k === 'a') { e.preventDefault(); actions.current.openPick('assignee'); }
      else if (k === 'l') { e.preventDefault(); actions.current.openPick('label'); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const who = (id: string | null) => USERS.find((u) => u.id === id);
  const assignee = (i: Issue) => { const u = who(i.assignee_id); return u ? <Avatar initials={u.initials} hue={u.hue} /> : <span className='av av-none' aria-hidden='true' />; };
  const select = (i: Issue, openPanel: boolean) => { setSelId(i.id); if (openPanel) setOpen(true); };

  const row = (i: Issue) => (
    <div key={i.id} role='option' data-id={i.id} tabIndex={current?.id === i.id ? 0 : -1} aria-selected={current?.id === i.id} className={`row${dragId === i.id ? ' dragging' : ''}${overKey === i.id ? ' over' : ''}`} {...dragProps(i)} onClick={() => select(i, true)}>
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
    <div key={i.id} role='option' aria-posinset={pos} aria-setsize={size} data-id={i.id} tabIndex={current?.id === i.id ? 0 : -1} aria-selected={current?.id === i.id} className={`card${dragId === i.id ? ' dragging' : ''}${overKey === i.id ? ' over' : ''}`} {...dragProps(i)} onClick={() => select(i, true)}>
      <div className='card-top'><span className='id'>{i.identifier ?? i.id}</span>{assignee(i)}</div>
      <div className='card-title'>{i.title}</div>
      <div className='card-meta'><PriorityIcon priority={i.priority} />{i.label_ids.map((l) => { const lb = LABELS.find((x) => x.id === l); return lb ? <span key={l} className={`chip ${lb.hue}`}>{lb.name}</span> : null; })}</div>
    </div>
  );

  return (
    <div className='shell'>
      <aside className='side' aria-label='Sidebar'>
        <div className='ws'><span className='ws-logo' aria-hidden='true'>D</span><span className='ws-name'>Delos</span></div>
        <button className='side-btn new' onClick={create}><Icon name='plus' /><span>New issue</span><kbd>C</kbd></button>
        <button className='side-btn' onClick={openPalette} aria-keyshortcuts='Meta+K Control+K'><Icon name='search' /><span>Search</span><kbd>⌘K</kbd></button>
        <nav aria-label='Primary'>
          <a className='side-link' href='#inbox' onClick={(e) => e.preventDefault()}><Icon name='inbox' /><span>Inbox</span></a>
          <a className='side-link' href='#my-issues' onClick={(e) => e.preventDefault()}><Icon name='issues' /><span>My issues</span></a>
          <a className='side-link' href='#views' onClick={(e) => e.preventDefault()}><Icon name='views' /><span>Views</span></a>
        </nav>
        <div className='side-label'>Your teams</div>
        <nav aria-label='Teams'>
          <a className='side-link' href='#team' onClick={(e) => e.preventDefault()}><Icon name='team' /><span>Delos</span></a>
          <a className={`side-link sub${view !== 'cycles' ? ' active' : ''}`} aria-current={view !== 'cycles' ? 'page' : undefined} href='#issues' onClick={(e) => { e.preventDefault(); if (view === 'cycles') setView('list'); }}><span>Issues</span></a>
          <a className={`side-link sub${view === 'cycles' ? ' active' : ''}`} aria-current={view === 'cycles' ? 'page' : undefined} href='#cycles' onClick={(e) => { e.preventDefault(); setView('cycles'); }}><span>Cycles</span></a>
          <a className='side-link sub' href='#projects' onClick={(e) => e.preventDefault()}><span>Projects</span></a>
        </nav>
      </aside>
      <main className='main' ref={mainRef}>
        <header className='head'>
          <div className='crumbs'><span>Delos</span><span className='sep'>/</span><h1 className='crumb-title'>{view === 'cycles' ? 'Cycles' : 'Issues'}</h1><span className='count'>{view === 'cycles' ? CYCLES.length : issues.length}</span></div>
          <div className='switch' role='group' aria-label='View'>
            <button aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name='list' /><span>List</span></button>
            <button aria-pressed={view === 'board'} onClick={() => setView('board')}><Icon name='board' /><span>Board</span></button>
          </div>
        </header>
        {view !== 'cycles' && !loadError && allIssues.length > 0 && (
          <div className='filterbar' role='toolbar' aria-label='Filters'>
            {FILTER_KEYS.map((k) => (
              <button key={k} id={`fb-${k}`} className={`fchip${filters[k].length ? ' on' : ''}`} aria-haspopup='dialog' onClick={(e) => setFilterPick({ kind: k, rect: e.currentTarget.getBoundingClientRect() })}>
                {FILTER_LABEL[k]}{filters[k].length > 0 && <span className='fval'>: {filterValueLabel(k)}</span>}
              </button>
            ))}
            {activeCount(filters) > 0 && <button className='fclear' onClick={() => setFilters(emptyFilters())}>Clear filters</button>}
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
            <button onClick={create}>Create issue <kbd>C</kbd></button>
          </div>
        ) : view === 'cycles' ? (
          <div className='scroll cycles'>
            {BUCKETS.map((b) => {
              const cs = CYCLES.filter((c) => cycleBucket(c, today) === b.id);
              return (
                <section key={b.id} className='group' aria-labelledby={`cy-${b.id}`}>
                  <h2 id={`cy-${b.id}`}><span>{b.title}</span><span className='count'>{cs.length}</span></h2>
                  {cs.length === 0 ? <p className='col-empty'>No {b.id} cycles</p> : cs.map((c) => {
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
          <div className='panel-head'><span className='id'>{current.identifier ?? current.id}</span><button onClick={() => setOpen(false)} aria-label='Close detail panel'>Esc</button></div>
          <h2>{current.title}</h2>
          <dl>
            <dt>Status</dt><dd><StatusIcon status={current.status} />{STATUS_LABEL[current.status]}</dd>
            <dt>Priority</dt><dd><PriorityIcon priority={current.priority} />{PRIORITY_LABEL[current.priority]}</dd>
            <dt>Labels</dt><dd>{current.label_ids.length ? current.label_ids.map((l) => LABELS.find((x) => x.id === l)?.name).join(', ') : 'None'}</dd>
            <dt>Assignee</dt><dd>{assignee(current)}{who(current.assignee_id)?.name ?? 'Unassigned'}</dd>
          </dl>
        </aside>
      )}
      {toast && <div className='toast' role='status' onClick={() => setToast(null)}>{toast}</div>}
      {pick && <Picker title={pick.kind === 'priority' ? 'Set priority' : pick.kind === 'assignee' ? 'Set assignee' : 'Set labels'} multi={pick.kind === 'label'} anchor={pick.rect} options={pickOptions()} onPick={applyPick} onClose={closePick} />}
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
              autoFocus role='combobox' aria-expanded='true' aria-controls='palette-list' aria-activedescendant={results[pi] ? `pc-${results[pi].id}` : undefined} aria-autocomplete='list' aria-label='Search commands' placeholder='Type a command or search…' value={q}
              onChange={(e) => { setQ(e.target.value); setPi(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setPi((p) => Math.min(p + 1, results.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setPi((p) => Math.max(p - 1, 0)); }
                else if (e.key === 'Enter') { const c = results[pi]; closePalette(); c?.run(); }
              }}
            />
            <ul id='palette-list' role='listbox' aria-label='Commands'>
              {results.map((c, idx) => (
                <li key={c.id} id={`pc-${c.id}`} role='option' aria-selected={idx === pi} onClick={() => { closePalette(); c.run(); }}><span>{c.label}</span>{c.hint && <kbd>{c.hint}</kbd>}</li>
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

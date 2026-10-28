'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { StatusIcon } from '@/components/icons';
import { STATUSES, STATUS_LABEL, type Issue, type Status } from '@/lib/issues';
import { MIN_QUERY, searchApi, searchLocal, snippetParts, type HitKind, type SearchHit } from '@/lib/search-client';

const TABS: { id: HitKind | null; label: string }[] = [{ id: null, label: 'All' }, { id: 'issue', label: 'Issues' }, { id: 'comment', label: 'Comments' }, { id: 'project', label: 'Projects' }];
const isStatus = (s: string | null): s is Status => !!s && (STATUSES as readonly string[]).includes(s);

export function SearchView({ initialQuery, initialKind, slug, mockIssues }: { initialQuery: string; initialKind: HitKind | null; slug: string | null; mockIssues: Issue[] }) {
  const [q, setQ] = useState(initialQuery);
  const [kind, setKind] = useState<HitKind | null>(initialKind);
  const [items, setItems] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const seq = useRef(0);

  // The URL carries q and kind, so a results page can be shared and reloaded.
  useEffect(() => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set('q', q.trim());
    if (kind) sp.set('kind', kind);
    window.history.replaceState(null, '', `/search${sp.size ? `?${sp}` : ''}`);
  }, [q, kind]);

  useEffect(() => {
    const term = q.trim(); const my = ++seq.current;
    if (term.length < MIN_QUERY) { setItems([]); setCursor(null); setState('idle'); return; }
    setState('loading');
    const t = setTimeout(async () => {
      const r = slug ? await searchApi(slug, term, { kind: kind ?? undefined, limit: 20 }) : searchLocal(mockIssues, term, kind ?? undefined, 50);
      if (my !== seq.current) return;
      if (!r) { setState('error'); setItems([]); setCursor(null); return; }
      setItems(r.items); setCursor(r.next_cursor); setState('idle');
    }, slug ? 200 : 0);
    return () => clearTimeout(t);
  }, [q, kind, slug, mockIssues]);

  async function more() {
    if (!slug || !cursor) return;
    const my = seq.current;
    const r = await searchApi(slug, q.trim(), { kind: kind ?? undefined, limit: 20, cursor });
    if (my !== seq.current) return;
    if (!r) { setState('error'); return; }
    setItems((prev) => [...prev, ...r.items]); setCursor(r.next_cursor);
  }

  const href = (h: SearchHit) => (h.kind === 'project' ? `/?view=projects` : `/?issue=${encodeURIComponent(h.issue_id ?? h.id)}`);
  const term = q.trim();
  return (
    <div className='shell'>
      <main className='main search-page'>
        <header className='head'><div className='crumbs'><Link href='/'>Issues</Link><span className='sep'>/</span><h1 className='crumb-title'>Search</h1></div></header>
        <div className='search-bar'>
          <input autoFocus aria-label='Search' placeholder='Search issues, comments and projects…' value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} />
          <div role='tablist' aria-label='Result type' className='search-tabs'>
            {TABS.map((t) => <button key={t.label} role='tab' aria-selected={kind === t.id} onClick={() => setKind(t.id)}>{t.label}</button>)}
          </div>
        </div>
        <div className='scroll' aria-live='polite'>
          {term.length < MIN_QUERY && <p className='col-empty'>Type at least {MIN_QUERY} characters to search.</p>}
          {term.length >= MIN_QUERY && state === 'error' && <p className='col-empty' role='alert'>Search failed. Try again.</p>}
          {term.length >= MIN_QUERY && state === 'loading' && items.length === 0 && <p className='col-empty'>Searching…</p>}
          {term.length >= MIN_QUERY && state === 'idle' && items.length === 0 && <p className='col-empty'>No results for “{term}”</p>}
          <ul className='search-list' aria-label='Results'>
            {items.map((h) => (
              <li key={`${h.kind}-${h.id}`} className='search-row row'>
                <Link href={href(h)} className='search-link'>
                  {isStatus(h.status) && <StatusIcon status={h.status} />}
                  {h.identifier && <b className='hit-id'>{h.identifier}</b>}
                  <span className='search-title'>{h.title}</span>
                  <span className='search-kind'>{h.kind === 'issue' && isStatus(h.status) ? STATUS_LABEL[h.status] : h.kind}</span>
                  {h.kind !== 'issue' && h.snippet && <span className='search-snippet'>{snippetParts(h.snippet).map((p, k) => (p.mark ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>))}</span>}
                </Link>
              </li>
            ))}
          </ul>
          {cursor && <button className='side-btn search-more' onClick={more}>Load more</button>}
        </div>
      </main>
    </div>
  );
}

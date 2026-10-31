'use client';
// The one app sidebar (Shell, issue page, Search): same `.side` markup everywhere. Shell passes handlers for in-page navigation;
// without a handler an item is a real link back into the Shell (standalone routes get their data from AppSidebar below).
import Link from 'next/link';
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Button, IconButton } from '@/components/ui';
import { SideIcon, TeamSection, WorkspaceSwitcher } from '@/components/SidebarParts';
import { httpInboxClient, mockInboxClient } from '@/lib/inbox-client';
import { EMPTY_PEOPLE, fetchNlPeople, type NlPeople } from '@/lib/nl-people';
import { listTeams, type Team } from '@/lib/settings-client';
import { SHORTCUTS, formatKeys } from '@/lib/shortcuts';
import { httpViewsClient, mockViewsClient, viewUrl, type SavedView } from '@/lib/views-client';

export type SidebarActive = { kind: 'inbox' | 'issues' | 'cycles' | 'projects' | 'search' | 'none'; teamId?: string | null; viewId?: string | null };

export type SidebarProps = {
  slug: string | null;
  people: NlPeople;
  unread: number;
  views: SavedView[];
  teams: Team[];
  /** Team that owns Cycles/Projects links (the others only list Issues). Null = every team. */
  homeTeamId: string | null;
  active: SidebarActive;
  readOnly?: boolean;
  id?: string;
  copied?: string | null;
  /** Closes the mobile drawer after a navigation / on Esc. */
  onNavigate?: () => void;
  navOpen?: boolean;
  onSearch?: () => void;
  onCompose?: () => void;
  onInbox?: () => void;
  onIssues?: (teamId: string) => void;
  onCycles?: (teamId: string) => void;
  onProjects?: (teamId: string) => void;
  onView?: (v: SavedView) => void;
  onCopyView?: (v: SavedView) => void;
  onDeleteView?: (v: SavedView) => void;
};

function SideLink({ href, onSelect, className, current, children, ...rest }: { href: string; onSelect: (() => void) | undefined; className: string; current: boolean; children: ReactNode; title?: string; 'data-team'?: string }) {
  const aria = current ? 'page' : undefined;
  if (onSelect) return <a className={className} aria-current={aria} href={href} onClick={(e: MouseEvent) => { e.preventDefault(); onSelect(); }} {...rest}>{children}</a>;
  return <Link className={className} aria-current={aria} href={href} {...rest}>{children}</Link>;
}

export function Sidebar(p: SidebarProps) {
  const { active } = p;
  const hint = (id: string) => { const d = SHORTCUTS.find((x) => x.id === id); return d ? formatKeys(d.keys).replace(' then ', ' ') : undefined; };
  const on = (k: SidebarActive['kind']) => active.kind === k;
  const noop = (e: MouseEvent) => e.preventDefault();
  return (
    <aside id={p.id ?? 'app-sidebar'} className='side' aria-label='Sidebar' onClick={p.onNavigate ? (e) => { if ((e.target as HTMLElement).closest('a.side-link')) p.onNavigate?.(); } : undefined} onKeyDown={p.onNavigate ? (e) => { if (e.key === 'Escape' && p.navOpen) { e.stopPropagation(); p.onNavigate?.(); } } : undefined}>
      <div className='side-head'>
        <WorkspaceSwitcher slug={p.slug} people={p.people} />
        {p.onSearch
          ? <IconButton className='side-icbtn' onClick={p.onSearch} label='Search' title='Search (⌘K)' aria-keyshortcuts='Meta+K Control+K'><SideIcon name='search' /></IconButton>
          : <Link className='side-icbtn' href='/search' aria-label='Search' aria-current={on('search') ? 'page' : undefined} title='Search'><SideIcon name='search' /></Link>}
        {!p.readOnly && p.onCompose && <IconButton className='side-icbtn compose' onClick={p.onCompose} label='New issue' title='New issue (C)' aria-keyshortcuts='C'><SideIcon name='compose' /></IconButton>}
      </div>
      <nav aria-label='Primary'>
        <SideLink className={`side-link${on('inbox') ? ' active' : ''}`} current={on('inbox')} href={p.onInbox ? '#inbox' : '/?view=inbox'} onSelect={p.onInbox}><SideIcon name='inbox' /><span>Inbox</span>{p.unread > 0 && <span className='badge' data-testid='inbox-badge' aria-label={`${p.unread} unread notifications`}>{p.unread > 99 ? '99+' : p.unread}</span>}</SideLink>
        <a className='side-link' href='#my-issues' onClick={noop}><SideIcon name='mine' /><span>My issues</span></a>
        <a className='side-link' href='#views' onClick={noop}><SideIcon name='views' /><span>Views</span></a>
        <div role='group' aria-label='Saved views' data-testid='saved-views'>
          {p.views.map((v) => (
            <div key={v.id} className='sv-row'>
              <SideLink className={`side-link sub${active.viewId === v.id ? ' active' : ''}`} current={active.viewId === v.id} href={p.onView ? `?v=${v.id}` : `/?v=${v.id}`} onSelect={p.onView ? () => p.onView?.(v) : undefined} title={v.name}><span className='sv-name'>{v.name}</span>{v.shared && <span className='sv-tag'>Shared</span>}</SideLink>
              <span className='sv-acts'><Button variant='ghost' size={24} className='sv-act' aria-label={`Copy link to ${v.name}`} onClick={() => p.onCopyView?.(v)}>{p.copied === v.id ? 'Copied' : 'Link'}</Button>
              {!p.readOnly && <Button variant='ghost' size={24} className='sv-act' aria-label={`Delete view ${v.name}`} onClick={() => p.onDeleteView?.(v)}>×</Button>}</span>
            </div>
          ))}
        </div>
      </nav>
      <div className='side-label'>Your teams</div>
      <nav aria-label='Teams'>
        {p.teams.map((t) => {
          const here = active.teamId == null || active.teamId === t.id;
          const home = p.homeTeamId == null || t.id === p.homeTeamId;
          const onIssues = on('issues') && here;
          return (
            <TeamSection key={t.id} id={p.teams.length > 1 ? `team-nav-${t.id}` : 'team-nav'} name={t.name}>
              <SideLink className={`side-link sub${onIssues ? ' active' : ''}`} current={onIssues} href={p.onIssues ? '#issues' : '/'} data-team={t.id} onSelect={p.onIssues ? () => p.onIssues?.(t.id) : undefined}><SideIcon name='issues' /><span>Issues</span>{home && hint('go-issues') && <kbd className='side-kbd' aria-hidden='true'>{hint('go-issues')}</kbd>}</SideLink>
              {home && (<>
                <SideLink className={`side-link sub${on('cycles') && here ? ' active' : ''}`} current={on('cycles') && here} href={p.onCycles ? '#cycles' : '/?view=cycles'} onSelect={p.onCycles ? () => p.onCycles?.(t.id) : undefined}><SideIcon name='cycles' /><span>Cycles</span></SideLink>
                <SideLink className={`side-link sub${on('projects') && here ? ' active' : ''}`} current={on('projects') && here} href={p.onProjects ? '#projects' : '/?view=projects'} onSelect={p.onProjects ? () => p.onProjects?.(t.id) : undefined}><SideIcon name='projects' /><span>Projects</span>{hint('go-projects') && <kbd className='side-kbd' aria-hidden='true'>{hint('go-projects')}</kbd>}</SideLink>
              </>)}
            </TeamSection>
          );
        })}
      </nav>
    </aside>
  );
}

/** Data for routes outside the Shell (issue page, Search): people, teams, saved views and the unread badge, same sources as Shell. */
export function AppSidebar({ slug, current, id, onNavigate, navOpen, teamId }: { slug: string | null; current: 'search' | 'issue'; /** Team that owns the open issue: only its Issues link is marked (none when unknown). */ teamId?: string | null; id?: string; onNavigate?: () => void; navOpen?: boolean }) {
  const [people, setPeople] = useState<NlPeople>(EMPTY_PEOPLE);
  const [teams, setTeams] = useState<Team[]>([]);
  const [views, setViews] = useState<SavedView[]>([]);
  const [unread, setUnread] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const viewsClient = useMemo(() => (slug ? httpViewsClient(slug) : mockViewsClient()), [slug]);
  useEffect(() => {
    let live = true;
    if (slug) {
      void fetchNlPeople(slug).then((x) => { if (live) setPeople(x); }).catch(() => { /* keep empty */ });
      void listTeams(slug).then((ts) => { if (live) setTeams(ts); }).catch(() => { /* keep fallback */ });
    }
    void viewsClient.list().then((l) => { if (live) setViews(l); }).catch(() => { /* none */ });
    const inbox = slug ? httpInboxClient(slug) : mockInboxClient();
    const tick = () => { void inbox.unreadCount().then((n) => { if (live) setUnread(n); }).catch(() => { /* keep */ }); };
    tick();
    const t = slug ? setInterval(tick, 30000) : undefined;
    return () => { live = false; if (t) clearInterval(t); };
  }, [slug, viewsClient]);
  const sideTeams = teams.length ? teams : [{ id: 'team', name: 'Team', key: '' }];
  return (
    <Sidebar
      slug={slug} people={people} unread={unread} views={views} teams={sideTeams} homeTeamId={teams[0]?.id ?? null}
      active={current === 'search' ? { kind: 'search' } : { kind: 'issues', teamId: teamId ?? '' }} id={id ?? 'app-sidebar'} copied={copied}
      {...(onNavigate ? { onNavigate, navOpen: navOpen ?? false } : {})}
      onCopyView={(v) => { void navigator.clipboard?.writeText(viewUrl(window.location.origin, '/', v.id)).catch(() => undefined); setCopied(v.id); setTimeout(() => setCopied((c) => (c === v.id ? null : c)), 1500); }}
      onDeleteView={(v) => { void viewsClient.remove(v).then((ok) => { if (ok) setViews((l) => l.filter((x) => x.id !== v.id)); }); }}
    />
  );
}

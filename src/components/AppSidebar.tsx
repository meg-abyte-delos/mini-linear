'use client';
// App sidebar for pages that live outside the Shell (Search): same chrome, links back into the Shell views.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SideIcon, TeamSection, WorkspaceSwitcher } from '@/components/SidebarParts';
import { EMPTY_PEOPLE, fetchNlPeople, type NlPeople } from '@/lib/nl-people';
import { listTeams } from '@/lib/settings-client';

export function AppSidebar({ slug, current, id, onNavigate }: { slug: string | null; current: 'search' | 'issue'; id?: string; onNavigate?: () => void }) {
  const [people, setPeople] = useState<NlPeople>(EMPTY_PEOPLE);
  const [teamName, setTeamName] = useState('Team');
  useEffect(() => {
    if (!slug) return;
    let live = true;
    void fetchNlPeople(slug).then((p) => { if (live) setPeople(p); }).catch(() => { /* keep empty */ });
    void listTeams(slug).then((ts) => { if (live && ts[0]) setTeamName(ts[0].name); }).catch(() => { /* keep fallback */ });
    return () => { live = false; };
  }, [slug]);
  return (
    <aside id={id} className='side' aria-label='Sidebar' onClick={onNavigate ? (e) => { if ((e.target as HTMLElement).closest('a')) onNavigate(); } : undefined}>
      <div className='side-head'>
        <WorkspaceSwitcher slug={slug} people={people} />
        <Link className='side-icbtn' href='/search' aria-label='Search' aria-current={current === 'search' ? 'page' : undefined} title='Search'><SideIcon name='search' /></Link>
      </div>
      <nav aria-label='Primary'>
        <Link className='side-link' href='/?view=inbox'><SideIcon name='inbox' /><span>Inbox</span></Link>
      </nav>
      <div className='side-label'>Your teams</div>
      <nav aria-label='Teams'>
        <TeamSection name={teamName}>
          <Link className='side-link sub' href='/'><SideIcon name='issues' /><span>Issues</span></Link>
          <Link className='side-link sub' href='/?view=cycles'><SideIcon name='cycles' /><span>Cycles</span></Link>
          <Link className='side-link sub' href='/?view=projects'><SideIcon name='projects' /><span>Projects</span></Link>
        </TeamSection>
      </nav>
    </aside>
  );
}

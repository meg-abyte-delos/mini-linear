'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { listTeams, type Team } from '@/lib/settings-client';
import '@/app/ui-settings.css';

// 'team:<id>' marks one team's page.
export type SettingsPage = 'general' | 'members' | 'teams' | 'notifications' | 'profile' | 'preferences' | `team:${string}`;

// Two-column settings layout: left nav + one centered content column. Pages put their own <h1> in `header`.
// One nav for every settings page: Account, Workspace, then the sub-list of the viewer's teams.
export function SettingsShell({ slug, current, header, children }: { slug: string; current: SettingsPage; header: ReactNode; children: ReactNode }) {
  const [teams, setTeams] = useState<Team[]>([]);
  useEffect(() => { let on = true; listTeams(slug, fetch, true).then((t) => { if (on) setTeams(t); }).catch(() => undefined); return () => { on = false; }; }, [slug]);
  const link = (page: SettingsPage, href: string, label: string) => (
    <a className='set-link' href={href} aria-current={current === page ? 'page' : undefined}>{label}</a>
  );
  const s = `/w/${slug}/settings`;
  return (
    <div className='set'>
      <nav className='set-nav' aria-label='Settings'>
        <Link className='set-back' href='/'><span aria-hidden='true'>&larr;</span> Back to app</Link>
        <p className='set-nav-h'>Account</p>
        {link('profile', `${s}/profile`, 'Profile')}
        {link('preferences', `${s}/preferences`, 'Preferences')}
        <p className='set-nav-h'>Workspace</p>
        {link('general', s, 'General')}
        {link('members', `/w/${slug}/members`, 'Members')}
        {link('teams', `${s}/teams`, 'Teams')}
        {link('notifications', `${s}/notifications`, 'Notifications')}
        {teams.length > 0 && <>
          <p className='set-nav-h' id='set-nav-teams'>Your teams</p>
          <div role='group' aria-labelledby='set-nav-teams' className='set-nav-sub'>
            {teams.map((t) => <span key={t.id} className='set-nav-item'>{link(`team:${t.id}`, `${s}/teams/${t.id}`, t.name)}</span>)}
          </div>
        </>}
      </nav>
      <main className='set-main'>
        <div className='set-wrap'>
          <header className='set-head'>{header}</header>
          {children}
        </div>
      </main>
    </div>
  );
}

import type { ReactNode } from 'react';
import Link from 'next/link';
import '@/app/ui-settings.css';

export type SettingsPage = 'general' | 'members';

// Two-column settings layout: left nav + one centered content column. Pages put their own <h1> in `header`.
export function SettingsShell({ slug, current, header, children }: { slug: string; current: SettingsPage; header: ReactNode; children: ReactNode }) {
  const link = (page: SettingsPage, href: string, label: string) => (
    <a className='set-link' href={href} aria-current={current === page ? 'page' : undefined}>{label}</a>
  );
  return (
    <div className='set'>
      <nav className='set-nav' aria-label='Settings'>
        <Link className='set-back' href='/'><span aria-hidden='true'>&larr;</span> Back to app</Link>
        <p className='set-nav-h'>Workspace</p>
        {link('general', `/w/${slug}/settings`, 'General')}
        {link('members', `/w/${slug}/members`, 'Members')}
        {current === 'general' && <>
          <a className='set-link' href='#teams'>Teams</a>
          <a className='set-link' href='#notifications'>Notifications</a>
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

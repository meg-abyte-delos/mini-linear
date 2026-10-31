'use client';
import { SettingsShell } from '@/components/SettingsShell';

const COPY = {
  profile: { title: 'Profile', desc: 'Your name and avatar.' },
  preferences: { title: 'Preferences', desc: 'Theme and home page.' },
} as const;

// Account pages. The nav entries land here first; the forms follow in their own PRs (lane point 3).
export function SettingsAccount({ slug, page }: { slug: string; page: keyof typeof COPY }) {
  const c = COPY[page];
  return (
    <SettingsShell slug={slug} current={page} header={<><h1 className='set-h1'>{c.title}</h1><p className='set-desc'>{c.desc}</p></>}>
      <p className='set-muted'>These settings are coming soon.</p>
    </SettingsShell>
  );
}

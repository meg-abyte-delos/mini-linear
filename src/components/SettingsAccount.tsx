'use client';
import { useEffect, useState } from 'react';
import * as S from '@/lib/settings-client';
import { Select, UserAvatar } from '@/components/ui';
import { SettingsShell } from '@/components/SettingsShell';
import { useToast } from '@/components/SettingsBits';

const COPY = {
  profile: { title: 'Profile', desc: 'Your name and avatar.' },
  preferences: { title: 'Preferences', desc: 'Theme and home page.' },
} as const;
const THEMES = [{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }, { id: 'system', label: 'System' }];
const HOMES = [{ id: 'inbox', label: 'Inbox' }, { id: 'my-issues', label: 'My issues' }, { id: 'projects', label: 'Projects' }, { id: 'views', label: 'Views' }];

// Account pages (per user, not per workspace). Save stays disabled until the form differs from what the server holds.
export function SettingsAccount({ slug, page }: { slug: string; page: keyof typeof COPY }) {
  const c = COPY[page];
  const [me, setMe] = useState<S.Me | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { S.getMe().then(setMe).catch((e: Error) => setErr(e.message)); }, []);
  const header = <><h1 className='set-h1'>{c.title}</h1><p className='set-desc'>{c.desc}</p></>;
  if (!me) return <SettingsShell slug={slug} current={page} header={header}>{err ? <p role='alert' className='set-error'>{err}</p> : <p role='status' className='set-muted'>Loading…</p>}</SettingsShell>;
  return <SettingsShell slug={slug} current={page} header={header}>{page === 'profile' ? <ProfileForm me={me} onSaved={setMe} /> : <PreferencesForm me={me} onSaved={setMe} />}</SettingsShell>;
}

function ProfileForm({ me, onSaved }: { me: S.Me; onSaved: (m: S.Me) => void }) {
  const [name, setName] = useState(me.display_name ?? '');
  const [avatar, setAvatar] = useState(me.avatar_url ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { show, toast } = useToast();
  const dirty = name.trim() !== (me.display_name ?? '') || avatar.trim() !== (me.avatar_url ?? '');
  const shown = name.trim() || me.display_name || me.email.split('@')[0]!;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true); setErr(null);
    const patch: Partial<S.Me> = {};
    if (name.trim() !== (me.display_name ?? '')) patch.display_name = name.trim() || null;
    if (avatar.trim() !== (me.avatar_url ?? '')) patch.avatar_url = avatar.trim() || null;
    try { const m = await S.patchMe(patch); onSaved(m); setName(m.display_name ?? ''); setAvatar(m.avatar_url ?? ''); show('Profile saved'); }
    catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  return (
    <section aria-label='Profile' className='set-section'>
      {toast}
      <form onSubmit={(e) => void save(e)} className='set-card set-form'>
        <div className='set-profile-row'>
          {/^https:\/\//.test(avatar.trim())
            // eslint-disable-next-line @next/next/no-img-element
            ? <img className='set-avatar-img' src={avatar.trim()} alt='' width={56} height={56} />
            : <UserAvatar userId={me.id} name={shown} size='lg' />}
          <div><strong>{shown}</strong><div className='set-muted'>{me.email}</div></div>
        </div>
        <label className='set-field'><span className='set-label'>Full name</span><input className='set-input' value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder='Your name' /></label>
        <label className='set-field'><span className='set-label'>Avatar URL (https)</span><input className='set-input' type='url' pattern='https://.*' value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder='https://example.com/me.png' /></label>
        {err && <p role='alert' className='set-error'>{err}</p>}
        <div className='set-actions'>
          {avatar && <button type='button' className='btn' data-size='32' data-variant='ghost' onClick={() => setAvatar('')}>Remove avatar</button>}
          <button type='submit' className='btn' data-size='32' data-variant='primary' disabled={!dirty || busy}>Save changes</button>
        </div>
      </form>
    </section>
  );
}

// Applies the theme at once (the server also sets the ml_theme cookie for first paint); system = no attribute.
function applyTheme(t: S.Me['theme']) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}

function PreferencesForm({ me, onSaved }: { me: S.Me; onSaved: (m: S.Me) => void }) {
  const [theme, setTheme] = useState<S.Me['theme']>(me.theme);
  const [home, setHome] = useState<S.HomePage>(me.home_page ?? 'inbox');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { show, toast } = useToast();
  const dirty = theme !== me.theme || home !== (me.home_page ?? 'inbox');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true); setErr(null);
    const patch: Partial<S.Me> = {};
    if (theme !== me.theme) patch.theme = theme;
    if (home !== (me.home_page ?? 'inbox')) patch.home_page = home;
    try { const m = await S.patchMe(patch); onSaved(m); applyTheme(m.theme); show('Preferences saved'); }
    catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  return (
    <section aria-label='Preferences' className='set-section'>
      {toast}
      <form onSubmit={(e) => void save(e)} className='set-card set-form'>
        <div className='set-field'><span className='set-label'>Theme</span><Select className='set-select' label='Theme' value={theme} options={THEMES} onChange={(v) => setTheme(v as S.Me['theme'])} /></div>
        <div className='set-field'><span className='set-label'>Home page</span><Select className='set-select' label='Home page' value={home} options={HOMES} onChange={(v) => setHome(v as S.HomePage)} /><span className='set-hint'>Where Delos opens when you sign in.</span></div>
        {err && <p role='alert' className='set-error'>{err}</p>}
        <div className='set-actions'><button type='submit' className='btn' data-size='32' data-variant='primary' disabled={!dirty || busy}>Save changes</button></div>
      </form>
    </section>
  );
}

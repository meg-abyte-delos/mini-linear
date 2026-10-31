'use client';
import { useCallback, useEffect, useState } from 'react';
import * as S from '@/lib/settings-client';
import { SettingsShell } from '@/components/SettingsShell';

const isAdmin = (r?: string) => r === 'owner' || r === 'admin';

export function Settings({ slug }: { slug: string }) {
  const [ws, setWs] = useState<S.WorkspaceSettings | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', logo_url: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const w = await S.getSettings(slug);
      setWs(w); setForm({ name: w.name, slug: w.slug, logo_url: w.logo_url ?? '' });
    } catch (e) { setMsg((e as Error).message); }
  }, [slug]);
  useEffect(() => { void reload(); }, [reload]);
  const h1 = <h1 className='set-h1'>General</h1>;
  if (!ws) return <SettingsShell slug={slug} current='general' header={h1}><p role='status' className='set-muted'>{msg ?? 'Loading settings…'}</p></SettingsShell>;
  const admin = isAdmin(ws.role);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = S.settingsPatch(ws, form);
    if (!Object.keys(p).length) return;
    try { const w = await S.patchSettings(slug, p); setMsg('Saved'); if (w.slug !== slug) window.location.assign(`/w/${w.slug}/settings`); else void reload(); }
    catch (err) { setMsg((err as Error).message); }
  };
  return (
    <SettingsShell slug={slug} current='general' header={<><h1 className='set-h1'>General</h1><p className='set-desc'>Your workspace name, URL and logo.</p></>}>
      {msg && <p role='status' className='toast'>{msg}</p>}
      <section aria-labelledby='ws-h' className='set-section'>
        <h2 id='ws-h' className='set-h2'>Workspace</h2>
        <form onSubmit={save} className='set-card set-form'>
          <label className='set-field'><span className='set-label'>Name</span><input className='set-input' value={form.name} disabled={!admin} maxLength={100} required onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className='set-field'><span className='set-label'>URL slug</span><input className='set-input' value={form.slug} disabled={!admin} pattern='[a-z0-9][a-z0-9-]{1,38}[a-z0-9]' required onChange={(e) => setForm({ ...form, slug: e.target.value })} /></label>
          <label className='set-field'><span className='set-label'>Logo URL (https)</span><span className='set-logo-row'>
            <input className='set-input' type='url' placeholder='https://example.com/logo.png' value={form.logo_url} disabled={!admin} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {ws.logo_url && <img className='set-logo' src={ws.logo_url} alt={`${ws.name} logo`} width={32} height={32} />}
          </span></label>
          {admin && <div className='set-actions'><button type='submit' className='btn' data-size='32' data-variant='primary'>Save changes</button></div>}
        </form>
      </section>
    </SettingsShell>
  );
}

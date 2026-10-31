'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as S from '@/lib/settings-client';
import { SettingsShell } from '@/components/SettingsShell';
import { NameConfirmDialog, useToast } from '@/components/SettingsBits';

const isAdmin = (r?: string) => r === 'owner' || r === 'admin';

export function Settings({ slug }: { slug: string }) {
  const [ws, setWs] = useState<S.WorkspaceSettings | null>(null);
  const [form, setForm] = useState({ name: '', slug: '' });
  const [logo, setLogo] = useState<{ file: File | null; preview: string | null; removed: boolean }>({ file: null, preview: null, removed: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { show, toast } = useToast();
  const reload = useCallback(async () => {
    try { const w = await S.getSettings(slug); setWs(w); setForm({ name: w.name, slug: w.slug }); }
    catch (e) { setErr((e as Error).message); }
  }, [slug]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => () => { if (logo.preview) URL.revokeObjectURL(logo.preview); }, [logo.preview]);
  const header = <><h1 className='set-h1'>General</h1><p className='set-desc'>Your workspace name, URL and logo.</p></>;
  if (!ws) return <SettingsShell slug={slug} current='general' header={header}><p role={err ? 'alert' : 'status'} className={err ? 'set-error' : 'set-muted'}>{err ?? 'Loading settings…'}</p></SettingsShell>;
  const admin = isAdmin(ws.role), owner = ws.role === 'owner';
  const dirty = form.name.trim() !== ws.name || form.slug.trim() !== ws.slug || !!logo.file || logo.removed;
  const pickLogo = (f: File | undefined) => {
    if (!f) return;
    if (!S.LOGO_TYPES.includes(f.type)) { setErr('Logo must be a PNG, JPEG or WebP image'); return; }
    if (f.size > S.LOGO_MAX_BYTES) { setErr('Logo is larger than 1 MB'); return; }
    setErr(null); setLogo({ file: f, preview: URL.createObjectURL(f), removed: false });
  };
  const shownLogo = logo.removed ? null : logo.preview ?? ws.logo_url;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true); setErr(null);
    try {
      let w = ws;
      if (logo.file) w = await S.uploadLogo(slug, logo.file);
      const p = S.settingsPatch(w, { name: form.name, slug: form.slug, logo_url: logo.removed ? '' : (w.logo_url ?? '') });
      if (Object.keys(p).length) w = await S.patchSettings(slug, p);
      setLogo({ file: null, preview: null, removed: false });
      show('Workspace saved');
      if (w.slug !== slug) window.location.assign(`/w/${w.slug}/settings`); else { setWs(w); setForm({ name: w.name, slug: w.slug }); }
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const destroy = async () => {
    setBusy(true);
    try { await S.deleteWorkspace(slug); window.location.assign('/'); }
    catch (x) { setErr((x as Error).message); setDelOpen(false); setBusy(false); }
  };
  return (
    <SettingsShell slug={slug} current='general' header={header}>
      {toast}
      <section aria-labelledby='ws-h' className='set-section'>
        <h2 id='ws-h' className='set-h2'>Workspace</h2>
        <form onSubmit={(e) => void save(e)} className='set-card set-form'>
          <div className='set-field'>
            <span className='set-label' id='logo-l'>Logo</span>
            <span className='set-logo-row'>
              {shownLogo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img className='set-logo' src={shownLogo} alt={`${ws.name} logo`} width={48} height={48} />
                : <span className='set-logo set-logo-none' aria-hidden='true'>{ws.name.charAt(0).toUpperCase()}</span>}
              {admin && <>
                <input ref={fileRef} type='file' className='set-file' accept='image/png,image/jpeg,image/webp' aria-labelledby='logo-l' onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
                <button type='button' className='btn' data-size='32' onClick={() => fileRef.current?.click()}>Upload logo</button>
                {shownLogo && <button type='button' className='btn' data-size='32' data-variant='ghost' onClick={() => setLogo({ file: null, preview: null, removed: true })}>Remove</button>}
                <span className='set-hint'>PNG, JPEG or WebP, up to 1 MB.</span>
              </>}
            </span>
          </div>
          <label className='set-field'><span className='set-label'>Name</span><input className='set-input' value={form.name} disabled={!admin} maxLength={100} required onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className='set-field'><span className='set-label'>URL slug</span>
            <span className='set-slug'><span className='set-slug-pre' aria-hidden='true'>/w/</span>
              <input className='set-input' value={form.slug} disabled={!admin} pattern='[a-z0-9][a-z0-9-]{1,38}[a-z0-9]' required aria-describedby='slug-prev' onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} /></span>
            <span className='set-hint' id='slug-prev'>Your workspace lives at /w/{form.slug || '…'}/issues{form.slug !== ws.slug && ' (links to the old URL will stop working)'}.</span>
          </label>
          {err && <p role='alert' className='set-error'>{err}</p>}
          {admin && <div className='set-actions'><button type='submit' className='btn' data-size='32' data-variant='primary' disabled={!dirty || busy}>Save changes</button></div>}
        </form>
      </section>
      {owner && (
        <section aria-labelledby='dz-h' className='set-section'>
          <h2 id='dz-h' className='set-h2'>Danger zone</h2>
          <div className='set-card set-danger-card'>
            <div className='set-danger-text'><strong>Delete this workspace</strong><span>Permanently deletes {ws.name}, its teams, issues and members. Only the owner can do this.</span></div>
            <button type='button' className='btn' data-size='32' data-tone='danger' onClick={() => setDelOpen(true)}>Delete workspace</button>
          </div>
        </section>
      )}
      <NameConfirmDialog open={delOpen} name={ws.name} busy={busy} title={`Delete ${ws.name}?`} confirmLabel='Delete workspace' onConfirm={() => void destroy()} onCancel={() => setDelOpen(false)}>
        This permanently deletes the workspace and everything in it. This cannot be undone.
      </NameConfirmDialog>
    </SettingsShell>
  );
}

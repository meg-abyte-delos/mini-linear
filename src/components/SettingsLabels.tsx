'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as S from '@/lib/settings-client';
import { teamSettingsApi, type Label } from '@/lib/team-settings-client';
import { SettingsShell } from '@/components/SettingsShell';
import { useToast } from '@/components/SettingsBits';
import { Input } from '@/components/ui/Input';

const isAdmin = (r?: string) => r === 'owner' || r === 'admin';

// Workspace labels (team_id null): shared by every team. Team labels stay on each team page.
export function SettingsLabels({ slug }: { slug: string }) {
  const api = useMemo(() => teamSettingsApi(slug), [slug]);
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [role, setRole] = useState<string | undefined>();
  const [draft, setDraft] = useState({ name: '', color: '#7c6cf0' });
  const [err, setErr] = useState<string | null>(null);
  const { show, toast } = useToast();
  const reload = useCallback(async () => {
    const [l, w] = await Promise.all([api.listLabels(), S.getSettings(slug).catch(() => null)]);
    if (w) setRole(w.role);
    if (l.ok) setLabels(l.data.items.filter((x) => x.team_id === null)); else setErr(l.message);
  }, [api, slug]);
  useEffect(() => { void reload(); }, [reload]);
  const admin = isAdmin(role);
  const run = async (p: Promise<{ ok: boolean; message?: string }>, ok: string) => { const r = await p; if (r.ok) { setErr(null); show(ok); await reload(); return true; } setErr(r.message ?? 'Request failed'); return false; };
  const header = <><h1 className='set-h1'>Labels</h1><p className='set-desc'>Workspace labels are available to every team.</p></>;
  return (
    <SettingsShell slug={slug} current='labels' header={header}>
      {toast}
      {err && <p role='alert' className='set-error'>{err}</p>}
      <section aria-label='Workspace labels' className='set-section'>
        {admin && (
          <form className='set-card set-form set-form-row' onSubmit={(e) => { e.preventDefault(); if (!draft.name.trim()) return; void run(api.createLabel({ name: draft.name.trim(), color: draft.color, team_id: null }), `Label ${draft.name.trim()} created`).then((ok) => { if (ok) setDraft({ ...draft, name: '' }); }); }}>
            <label className='set-field set-grow'><span className='set-label'>New label</span><Input size={32} value={draft.name} maxLength={50} placeholder='e.g. Bug' onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className='set-field'><span className='set-label'>Color</span><input className='set-color' type='color' aria-label='New label color' value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></label>
            <button type='submit' className='btn' data-size='32' data-variant='primary' disabled={!draft.name.trim()}>Add label</button>
          </form>
        )}
        {!labels ? <p role='status' className='set-muted'>Loading labels…</p> : labels.length === 0 ? <p className='set-muted'>No workspace labels yet.</p> : (
          <ul className='set-card set-flush set-label-list'>
            {labels.map((l) => (
              <li key={l.id} className='set-label-row'>
                {admin
                  ? <Input size={32} className='set-label-name' aria-label={`Name of label ${l.name}`} defaultValue={l.name} maxLength={50} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) void run(api.patchLabel(l, { name: v }), 'Label renamed'); else e.target.value = l.name; }} />
                  : <span>{l.name}</span>}
                {admin && <>
                  <input className='set-color' type='color' aria-label={`Color of ${l.name}`} defaultValue={l.color} onBlur={(e) => { if (e.target.value !== l.color) void run(api.patchLabel(l, { color: e.target.value }), 'Label color saved'); }} />
                  <button type='button' className='btn' data-size='32' data-variant='ghost' data-tone='danger' aria-label={`Delete label ${l.name}`} onClick={() => { if (window.confirm(`Delete label ${l.name}? It is removed from every issue.`)) void run(api.deleteLabel(l), `Label ${l.name} deleted`); }}>Delete</button>
                </>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </SettingsShell>
  );
}

'use client';
import { useCallback, useEffect, useState } from 'react';
import * as S from '@/lib/settings-client';
import { NameConfirmDialog } from '@/components/SettingsBits';
import { SettingsShell } from '@/components/SettingsShell';
import { TeamPanel } from '@/components/SettingsTeamPanel';
const isAdmin = (r?: string) => r === 'owner' || r === 'admin';
export function SettingsTeams({ slug }: { slug: string }) {
  const [ws, setWs] = useState<S.WorkspaceSettings | null>(null);
  const [teams, setTeams] = useState<S.Team[]>([]);
  const [members, setMembers] = useState<S.Member[]>([]);
  const [newTeam, setNewTeam] = useState({ name: '', key: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [delTeam, setDelTeam] = useState<S.Team | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      setWs(await S.getSettings(slug));
      setTeams(await S.listTeams(slug));
      setMembers(await S.listMembers(slug).catch(() => []));
    } catch (e) { setMsg((e as Error).message); }
  }, [slug]);
  useEffect(() => { void reload(); }, [reload]);
  const header = <><h1 className='set-h1'>Teams</h1><p className='set-desc'>Create teams and manage who is in them.</p></>;
  if (!ws) return <SettingsShell slug={slug} current='teams' header={header}><p role='status' className='set-muted'>{msg ?? 'Loading teams…'}</p></SettingsShell>;
  const admin = isAdmin(ws.role);
  const confirmDelete = async () => {
    if (!delTeam) return;
    setBusy(true);
    try { await S.deleteTeam(slug, delTeam.id); setDelTeam(null); void reload(); } catch (err) { setMsg((err as Error).message); setDelTeam(null); }
    setBusy(false);
  };
  return (
    <SettingsShell slug={slug} current='teams' header={header}>
      {msg && <p role='status' className='toast'>{msg}</p>}
      <section aria-label='Teams' className='set-section'>
        {admin && (
          <form className='set-card set-form set-form-row' onSubmit={async (e) => { e.preventDefault(); try { await S.createTeam(slug, newTeam.name.trim(), newTeam.key); setNewTeam({ name: '', key: '' }); void reload(); } catch (err) { setMsg((err as Error).message); } }}>
            <label className='set-field set-grow'><span className='set-label'>Team name</span><input className='set-input' placeholder='e.g. Design' value={newTeam.name} required maxLength={100} onChange={(e) => setNewTeam({ name: e.target.value, key: S.suggestKey(e.target.value) })} /></label>
            <label className='set-field set-key-field'><span className='set-label'>Key</span><input className='set-input' placeholder='DES' value={newTeam.key} required pattern='[A-Z]{2,5}' onChange={(e) => setNewTeam({ ...newTeam, key: e.target.value.toUpperCase() })} /></label>
            <button type='submit' className='btn' data-size='32' data-variant='primary'>Create team</button>
          </form>
        )}
        {teams.map((t) => <TeamPanel key={t.id} slug={slug} team={t} members={members} canAdmin={admin} onChanged={setMsg} onDelete={() => setDelTeam(t)} />)}
      </section>
      <NameConfirmDialog open={!!delTeam} name={delTeam?.name ?? ''} busy={busy} title={`Delete ${delTeam?.name ?? 'team'}?`} confirmLabel='Delete team' onConfirm={() => void confirmDelete()} onCancel={() => setDelTeam(null)}>
        This permanently deletes the team and all of its issues. This cannot be undone.
      </NameConfirmDialog>
    </SettingsShell>
  );
}

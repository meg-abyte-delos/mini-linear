'use client';
import { useCallback, useEffect, useState } from 'react';
import * as S from '@/lib/settings-client';
import { NameConfirmDialog } from '@/components/SettingsBits';
import { SettingsShell } from '@/components/SettingsShell';
import { TeamPanel } from '@/components/SettingsTeamPanel';
import { TeamSettings } from '@/components/TeamSettings';

const isAdmin = (r?: string) => r === 'owner' || r === 'admin';

// One page per team inside the shared settings shell: its members, then workflow / estimates / cycles / labels.
export function SettingsTeamPage({ slug, teamId }: { slug: string; teamId: string }) {
  const [ws, setWs] = useState<S.WorkspaceSettings | null>(null);
  const [team, setTeam] = useState<S.Team | null>(null);
  const [members, setMembers] = useState<S.Member[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      const [w, teams] = await Promise.all([S.getSettings(slug), S.listTeams(slug, fetch, true)]);
      setWs(w);
      const t = teams.find((x) => x.id === teamId) ?? null;
      setTeam(t); setMissing(!t);
      setMembers(await S.listMembers(slug).catch(() => []));
    } catch (e) { setMsg((e as Error).message); }
  }, [slug, teamId]);
  useEffect(() => { void reload(); }, [reload]);
  const current = `team:${teamId}` as const;
  if (missing) return <SettingsShell slug={slug} current={current} header={<h1 className='set-h1'>Team not found</h1>}><p role='alert' className='set-error'>This team does not exist or you cannot see it.</p></SettingsShell>;
  if (!ws || !team) return <SettingsShell slug={slug} current={current} header={<h1 className='set-h1'>Team</h1>}><p role='status' className='set-muted'>{msg ?? 'Loading team…'}</p></SettingsShell>;
  const remove = async () => {
    setBusy(true);
    try { await S.deleteTeam(slug, team.id); window.location.assign(`/w/${slug}/settings/teams`); }
    catch (err) { setMsg((err as Error).message); setConfirm(false); setBusy(false); }
  };
  return (
    <SettingsShell slug={slug} current={current} header={<><h1 className='set-h1'>{team.name} <span className='set-key'>{team.key}</span></h1><p className='set-desc'>Members, workflow, estimates, cycles and labels for this team.</p></>}>
      {msg && <p role='status' className='toast'>{msg}</p>}
      <TeamPanel slug={slug} team={team} members={members} canAdmin={isAdmin(ws.role)} onChanged={setMsg} onDelete={() => setConfirm(true)} />
      <TeamSettings slug={slug} teamId={teamId} embedded readOnly={!isAdmin(ws.role)} />
      <NameConfirmDialog open={confirm} name={team.name} busy={busy} title={`Delete ${team.name}?`} confirmLabel='Delete team' onConfirm={() => void remove()} onCancel={() => setConfirm(false)}>
        This permanently deletes the team and all of its issues. This cannot be undone.
      </NameConfirmDialog>
    </SettingsShell>
  );
}

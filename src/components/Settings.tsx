'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as S from '@/lib/settings-client';
import { httpInboxClient, NOTIF_TYPES, TYPE_LABEL, type PrefMap, type NotifType } from '@/lib/inbox-client';
import { nameFromEmail } from '@/lib/nl-people';
import { ConfirmDialog, Select, UserAvatar } from '@/components/ui';
import { SettingsShell } from '@/components/SettingsShell';

const TEAM_ROLES = [{ id: 'admin', label: 'Admin' }, { id: 'member', label: 'Member' }, { id: 'guest', label: 'Guest (read-only)' }];
const isAdmin = (r?: string) => r === 'owner' || r === 'admin';

function TeamPanel({ slug, team, members, canAdmin, onChanged, onDelete }: { slug: string; team: S.Team; members: S.Member[]; canAdmin: boolean; onChanged: (msg: string) => void; onDelete: () => void }) {
  const [rows, setRows] = useState<S.TeamMember[]>([]);
  const [add, setAdd] = useState('');
  const load = useCallback(() => S.listTeamMembers(slug, team.id).then(setRows).catch((e) => onChanged(e.message)), [slug, team.id, onChanged]);
  useEffect(() => { void load(); }, [load]);
  const run = (p: Promise<unknown>) => p.then(load).catch((e: Error) => onChanged(e.message));
  const outside = members.filter((m) => !rows.some((r) => r.user_id === m.user_id));
  return (
    <section aria-labelledby={`team-${team.id}`} className='set-card set-team'>
      <div className='set-card-head'>
        <h3 id={`team-${team.id}`} className='set-card-title'>{team.name} <span className='set-key'>{team.key}</span></h3>
        {canAdmin && <button type='button' className='btn' data-size='32' data-tone='danger' onClick={onDelete}>Delete {team.name}</button>}
      </div>
      <table className='set-table'>
        <thead><tr><th scope='col'>Member</th><th scope='col'>Team role</th><th scope='col'><span className='sr-only'>Actions</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user_id}>
              <td><span className='set-person'><UserAvatar userId={r.user_id} name={nameFromEmail(r.email)} size='md' /><span className='set-person-text'>{r.email}</span></span></td>
              <td>
                <Select className='set-select' label={`Team role for ${r.email}`} value={r.role} disabled={!canAdmin} options={TEAM_ROLES}
                  onChange={(id) => run(S.setTeamRole(slug, team.id, r.user_id, id as S.TeamRole))} />
              </td>
              <td className='set-end'>{canAdmin && <button type='button' className='btn' data-size='32' data-variant='ghost' data-tone='danger' onClick={() => run(S.removeTeamMember(slug, team.id, r.user_id))}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canAdmin && outside.length > 0 && (
        <form className='set-inline' onSubmit={(e) => { e.preventDefault(); if (!add) return; const m = members.find((x) => x.user_id === add); void run(S.addTeamMember(slug, team.id, add, m?.role === 'guest' ? 'guest' : 'member')); setAdd(''); }}>
          <span className='set-inline-label'>Add member</span>
          <Select className='set-select' searchable label='Add member' value={add} placeholder='Choose…' options={outside.map((m) => ({ id: m.user_id, label: m.email }))} onChange={setAdd} />
          <button type='submit' className='btn' data-size='32' disabled={!add}>Add</button>
        </form>
      )}
    </section>
  );
}

function NotificationPrefs({ slug, onMsg }: { slug: string; onMsg: (m: string) => void }) {
  const client = useMemo(() => httpInboxClient(slug), [slug]);
  const [prefs, setPrefs] = useState<PrefMap | null>(null);
  useEffect(() => { void client.getPrefs().then((p) => { if (p) setPrefs(p); else onMsg('Could not load notification preferences'); }); }, [client, onMsg]);
  if (!prefs) return null;
  const set = async (t: NotifType, k: 'in_app' | 'email', v: boolean) => {
    const prev = prefs;
    setPrefs({ ...prefs, [t]: { ...prefs[t], [k]: v } });
    const r = await client.putPrefs({ [t]: { [k]: v } });
    if (r) setPrefs(r); else { setPrefs(prev); onMsg('Could not save notification preferences'); }
  };
  return (
    <section id='notifications' aria-labelledby='np-h' className='set-section'>
      <h2 id='np-h' className='set-h2'>Notifications</h2>
      <p className='set-desc'>Choose where you hear about activity that involves you.</p>
      <div className='set-card'>
        <table className='set-table'>
          <thead><tr><th scope='col'>When someone…</th><th scope='col' className='set-center'>In app</th><th scope='col' className='set-center'>Email</th></tr></thead>
          <tbody>
            {NOTIF_TYPES.map((t) => (
              <tr key={t}>
                <td>{TYPE_LABEL[t]}</td>
                <td className='set-center'><input type='checkbox' className='set-check' aria-label={`In-app: ${TYPE_LABEL[t]}`} checked={prefs[t].in_app} onChange={(e) => void set(t, 'in_app', e.target.checked)} /></td>
                <td className='set-center'><input type='checkbox' className='set-check' aria-label={`Email: ${TYPE_LABEL[t]}`} checked={prefs[t].email} onChange={(e) => void set(t, 'email', e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Settings({ slug }: { slug: string }) {
  const [ws, setWs] = useState<S.WorkspaceSettings | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', logo_url: '' });
  const [teams, setTeams] = useState<S.Team[]>([]);
  const [members, setMembers] = useState<S.Member[]>([]);
  const [newTeam, setNewTeam] = useState({ name: '', key: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [delTeam, setDelTeam] = useState<S.Team | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      const w = await S.getSettings(slug);
      setWs(w); setForm({ name: w.name, slug: w.slug, logo_url: w.logo_url ?? '' });
      setTeams(await S.listTeams(slug));
      setMembers(await S.listMembers(slug).catch(() => []));
    } catch (e) { setMsg((e as Error).message); }
  }, [slug]);
  useEffect(() => { void reload(); }, [reload]);
  const h1 = <h1 className='set-h1'>Settings</h1>;
  if (!ws) return <SettingsShell slug={slug} current='general' header={h1}><p role='status' className='set-muted'>{msg ?? 'Loading settings…'}</p></SettingsShell>;
  const admin = isAdmin(ws.role);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = S.settingsPatch(ws, form);
    if (!Object.keys(p).length) return;
    try { const w = await S.patchSettings(slug, p); setMsg('Saved'); if (w.slug !== slug) window.location.assign(`/w/${w.slug}/settings`); else void reload(); }
    catch (err) { setMsg((err as Error).message); }
  };
  const confirmDelete = async () => {
    if (!delTeam) return;
    setBusy(true);
    try { await S.deleteTeam(slug, delTeam.id); setDelTeam(null); void reload(); } catch (err) { setMsg((err as Error).message); setDelTeam(null); }
    setBusy(false);
  };
  return (
    <SettingsShell slug={slug} current='general' header={<><h1 className='set-h1'>Settings</h1><p className='set-desc'>Manage your workspace, its teams and your notifications.</p></>}>
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
      <section id='teams' aria-labelledby='teams-h' className='set-section'>
        <h2 id='teams-h' className='set-h2'>Teams</h2>
        {admin && (
          <form className='set-card set-form set-form-row' onSubmit={async (e) => { e.preventDefault(); try { await S.createTeam(slug, newTeam.name.trim(), newTeam.key); setNewTeam({ name: '', key: '' }); void reload(); } catch (err) { setMsg((err as Error).message); } }}>
            <label className='set-field set-grow'><span className='set-label'>Team name</span><input className='set-input' placeholder='e.g. Design' value={newTeam.name} required maxLength={100} onChange={(e) => setNewTeam({ name: e.target.value, key: S.suggestKey(e.target.value) })} /></label>
            <label className='set-field set-key-field'><span className='set-label'>Key</span><input className='set-input' placeholder='DES' value={newTeam.key} required pattern='[A-Z]{2,5}' onChange={(e) => setNewTeam({ ...newTeam, key: e.target.value.toUpperCase() })} /></label>
            <button type='submit' className='btn' data-size='32' data-variant='primary'>Create team</button>
          </form>
        )}
        {teams.map((t) => <TeamPanel key={t.id} slug={slug} team={t} members={members} canAdmin={admin} onChanged={setMsg} onDelete={() => setDelTeam(t)} />)}
      </section>
      <NotificationPrefs slug={slug} onMsg={setMsg} />
      <ConfirmDialog open={!!delTeam} destructive busy={busy} title={`Delete ${delTeam?.name ?? 'team'}?`} confirmLabel='Delete team' onConfirm={() => void confirmDelete()} onCancel={() => setDelTeam(null)}>
        This permanently deletes the team and all of its issues. This cannot be undone.
      </ConfirmDialog>
    </SettingsShell>
  );
}

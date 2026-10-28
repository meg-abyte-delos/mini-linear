'use client';
import { useCallback, useEffect, useState } from 'react';
import * as S from '@/lib/settings-client';

const isAdmin = (r?: string) => r === 'owner' || r === 'admin';

function TeamPanel({ slug, team, members, canAdmin, onChanged }: { slug: string; team: S.Team; members: S.Member[]; canAdmin: boolean; onChanged: (msg: string) => void }) {
  const [rows, setRows] = useState<S.TeamMember[]>([]);
  const [add, setAdd] = useState('');
  const load = useCallback(() => S.listTeamMembers(slug, team.id).then(setRows).catch((e) => onChanged(e.message)), [slug, team.id, onChanged]);
  useEffect(() => { void load(); }, [load]);
  const run = (p: Promise<unknown>) => p.then(load).catch((e: Error) => onChanged(e.message));
  const outside = members.filter((m) => !rows.some((r) => r.user_id === m.user_id));
  return (
    <section aria-labelledby={`team-${team.id}`} className='settings-card'>
      <h3 id={`team-${team.id}`}>{team.name} <span className='count'>{team.key}</span></h3>
      <table>
        <thead><tr><th scope='col'>Member</th><th scope='col'>Team role</th><th scope='col'><span className='sr-only'>Actions</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user_id}>
              <td>{r.email}</td>
              <td>
                <select aria-label={`Team role for ${r.email}`} value={r.role} disabled={!canAdmin}
                  onChange={(e) => run(S.setTeamRole(slug, team.id, r.user_id, e.target.value as S.TeamRole))}>
                  <option value='admin'>Admin</option><option value='member'>Member</option><option value='guest'>Guest (read-only)</option>
                </select>
              </td>
              <td>{canAdmin && <button type='button' onClick={() => run(S.removeTeamMember(slug, team.id, r.user_id))}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canAdmin && outside.length > 0 && (
        <form onSubmit={(e) => { e.preventDefault(); if (!add) return; const m = members.find((x) => x.user_id === add); void run(S.addTeamMember(slug, team.id, add, m?.role === 'guest' ? 'guest' : 'member')); setAdd(''); }}>
          <label>Add member <select value={add} onChange={(e) => setAdd(e.target.value)}>
            <option value=''>Choose…</option>{outside.map((m) => <option key={m.user_id} value={m.user_id}>{m.email}</option>)}
          </select></label>
          <button type='submit' disabled={!add}>Add</button>
        </form>
      )}
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
  const reload = useCallback(async () => {
    try {
      const w = await S.getSettings(slug);
      setWs(w); setForm({ name: w.name, slug: w.slug, logo_url: w.logo_url ?? '' });
      setTeams(await S.listTeams(slug));
      setMembers(await S.listMembers(slug).catch(() => []));
    } catch (e) { setMsg((e as Error).message); }
  }, [slug]);
  useEffect(() => { void reload(); }, [reload]);
  if (!ws) return <main className='settings'><p role='status'>{msg ?? 'Loading settings…'}</p></main>;
  const admin = isAdmin(ws.role);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = S.settingsPatch(ws, form);
    if (!Object.keys(p).length) return;
    try { const w = await S.patchSettings(slug, p); setMsg('Saved'); if (w.slug !== slug) window.location.assign(`/w/${w.slug}/settings`); else void reload(); }
    catch (err) { setMsg((err as Error).message); }
  };
  return (
    <main className='settings'>
      <h1>Settings</h1>
      {msg && <p role='status' className='toast'>{msg}</p>}
      <section aria-labelledby='ws-h' className='settings-card'>
        <h2 id='ws-h'>Workspace</h2>
        <form onSubmit={save}>
          <label>Name <input value={form.name} disabled={!admin} maxLength={100} required onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>URL slug <input value={form.slug} disabled={!admin} pattern='[a-z0-9][a-z0-9-]{1,38}[a-z0-9]' required onChange={(e) => setForm({ ...form, slug: e.target.value })} /></label>
          <label>Logo URL (https) <input type='url' value={form.logo_url} disabled={!admin} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} /></label>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {ws.logo_url && <img src={ws.logo_url} alt={`${ws.name} logo`} width={32} height={32} />}
          {admin && <button type='submit'>Save</button>}
        </form>
      </section>
      <section aria-labelledby='teams-h' className='settings-card'>
        <h2 id='teams-h'>Teams</h2>
        {admin && (
          <form onSubmit={async (e) => { e.preventDefault(); try { await S.createTeam(slug, newTeam.name.trim(), newTeam.key); setNewTeam({ name: '', key: '' }); void reload(); } catch (err) { setMsg((err as Error).message); } }}>
            <label>Team name <input value={newTeam.name} required maxLength={100} onChange={(e) => setNewTeam({ name: e.target.value, key: S.suggestKey(e.target.value) })} /></label>
            <label>Key <input value={newTeam.key} required pattern='[A-Z]{2,5}' onChange={(e) => setNewTeam({ ...newTeam, key: e.target.value.toUpperCase() })} /></label>
            <button type='submit'>Create team</button>
          </form>
        )}
        {teams.map((t) => (
          <div key={t.id}>
            <TeamPanel slug={slug} team={t} members={members} canAdmin={admin} onChanged={setMsg} />
            {admin && <button type='button' onClick={async () => { if (!window.confirm(`Delete team ${t.name} and all its issues?`)) return; try { await S.deleteTeam(slug, t.id); void reload(); } catch (err) { setMsg((err as Error).message); } }}>Delete {t.name}</button>}
          </div>
        ))}
      </section>
    </main>
  );
}

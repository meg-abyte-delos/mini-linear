'use client';
import { useCallback, useEffect, useState } from 'react';
import * as S from '@/lib/settings-client';
import { personName } from '@/lib/nl-people';
import { Select, UserAvatar } from '@/components/ui';
import { RowMenu } from '@/components/RowMenu';

const TEAM_ROLES = [{ id: 'admin', label: 'Admin' }, { id: 'member', label: 'Member' }, { id: 'guest', label: 'Guest (read-only)' }];

export function TeamPanel({ slug, team, members, canAdmin, onChanged, onDelete }: { slug: string; team: S.Team; members: S.Member[]; canAdmin: boolean; onChanged: (msg: string) => void; onDelete: () => void }) {
  const [rows, setRows] = useState<S.TeamMember[]>([]);
  const [add, setAdd] = useState('');
  const load = useCallback(() => S.listTeamMembers(slug, team.id).then(setRows).catch((e) => onChanged(e.message)), [slug, team.id, onChanged]);
  useEffect(() => { void load(); }, [load]);
  const run = (p: Promise<unknown>) => p.then(load).catch((e: Error) => onChanged(e.message));
  const outside = members.filter((m) => !rows.some((r) => r.user_id === m.user_id));
  return (
    <section aria-labelledby={`team-${team.id}`} className='set-card set-team'>
      <div className='set-card-head'>
        <h3 id={`team-${team.id}`} className='set-card-title'><a className='set-team-link' href={`/w/${slug}/settings/teams/${team.id}`}>{team.name}</a> <span className='set-key'>{team.key}</span></h3>
      </div>
      <table className='set-table'>
        <thead><tr><th scope='col'>Member</th><th scope='col'>Team role</th><th scope='col'><span className='sr-only'>Actions</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user_id}>
              <td><span className='set-person'><UserAvatar userId={r.user_id} name={personName(r)} size='md' /><span className='set-person-text'>{r.email}</span></span></td>
              <td>
                <Select className='set-select' label={`Team role for ${r.email}`} value={r.role} disabled={!canAdmin} options={TEAM_ROLES}
                  onChange={(id) => run(S.setTeamRole(slug, team.id, r.user_id, id as S.TeamRole))} />
              </td>
              <td className='set-end'>{canAdmin && <RowMenu label={`Actions for ${r.email}`} entries={[{ id: 'remove', label: 'Remove from team', destructive: true, onSelect: () => void run(S.removeTeamMember(slug, team.id, r.user_id)) }]} />}</td>
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
      {canAdmin && (
        <div className='set-danger' role='group' aria-label={`Danger zone for ${team.name}`}>
          <div className='set-danger-text'><strong>Delete this team</strong><span>Permanently deletes {team.name} and all of its issues.</span></div>
          <button type='button' className='btn' data-size='32' data-tone='danger' aria-label={`Delete team ${team.name}`} onClick={onDelete}>Delete team</button>
        </div>
      )}
    </section>
  );
}


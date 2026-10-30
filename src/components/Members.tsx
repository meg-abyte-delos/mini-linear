'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as S from '@/lib/settings-client';
import { nameFromEmail } from '@/lib/nl-people';
import { ConfirmDialog, Menu, Popover, UserAvatar, type MenuEntry } from '@/components/ui';
import { SettingsShell } from '@/components/SettingsShell';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isAdmin = (r?: string) => r === 'owner' || r === 'admin';
const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

function RowMenu({ label, entries }: { label: string; entries: MenuEntry[] }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} type='button' className='set-icon-btn' aria-label={label} aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox='0 0 16 16' width='16' height='16' fill='currentColor' aria-hidden='true' focusable='false'><circle cx='3' cy='8' r='1.3' /><circle cx='8' cy='8' r='1.3' /><circle cx='13' cy='8' r='1.3' /></svg>
      </button>
      <Menu open={open} anchorRef={ref} onClose={() => setOpen(false)} label={label} entries={entries} align='end' />
    </>
  );
}

function InvitePopover({ open, anchorRef, onClose, roles, onSend }: { open: boolean; anchorRef: React.RefObject<HTMLElement | null>; onClose: () => void; roles: S.AssignableRole[]; onSend: (email: string, role: 'admin' | 'member' | 'guest') => Promise<string | null> }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member' | 'guest'>('member');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const m = await onSend(email, role);
    setBusy(false);
    if (m) setErr(m); else { setEmail(''); setRole('member'); onClose(); }
  };
  return (
    <Popover open={open} anchorRef={anchorRef} onClose={onClose} label='Invite people' align='end'>
      <form className='set-invite' onSubmit={(e) => void submit(e)}>
        <p className='set-invite-h'>Invite to workspace</p>
        <label className='set-field'><span className='set-label'>Email</span><input className='set-input' type='email' required value={email} onChange={(e) => setEmail(e.target.value)} placeholder='name@company.com' /></label>
        <label className='set-field'><span className='set-label'>Role</span>
          <select className='set-select' value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member' | 'guest')}>
            {roles.map((r) => <option key={r} value={r}>{cap(r)}</option>)}
          </select>
        </label>
        {err && <p role='alert' className='set-error'>{err}</p>}
        <div className='set-actions'>
          <button type='button' className='set-btn' onClick={onClose}>Cancel</button>
          <button type='submit' className='set-btn' data-variant='primary' disabled={busy || !email.trim()}>Send invite</button>
        </div>
      </form>
    </Popover>
  );
}

// Workspace directory. Admins can invite, change roles and remove people; everyone else gets the read-only list.
// The API has no deactivated state (removing a member deletes the membership), so every listed row is Active.
export function Members({ slug }: { slug: string }) {
  const [rows, setRows] = useState<S.MemberRow[] | null>(null);
  const [invites, setInvites] = useState<S.Invite[]>([]);
  const [role, setRole] = useState<string | undefined>();
  const [meId, setMeId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<S.MemberRow | null>(null);
  const [busy, setBusy] = useState(false);
  const inviteBtn = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const [list, ws, me] = await Promise.all([
        S.listAllMembers(slug),
        S.getSettings(slug).catch(() => null),
        fetch('/api/v1/me').then((r) => (r.ok ? (r.json() as Promise<{ id?: string }>) : null)).catch(() => null),
      ]);
      setRows(list); setRole(ws?.role); setMeId(me?.id ?? null);
      setInvites(isAdmin(ws?.role) ? await S.listInvites(slug).catch(() => []) : []);
    } catch (e) { setErr((e as S.SettingsError).status === 403 ? 'You do not have access to this workspace.' : 'Could not load members'); }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  const admin = isAdmin(role);
  const shown = useMemo(() => (rows ?? []).filter((m) => S.matchesMember(m, nameFromEmail(m.email), q)), [rows, q]);
  const act = async (p: Promise<unknown>, ok: string) => { try { await p; setMsg(ok); await load(); } catch (e) { setMsg((e as Error).message); } };
  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    await act(S.removeMember(slug, removing.user_id), `Removed ${removing.email}`);
    setBusy(false); setRemoving(null);
  };
  const send = async (email: string, r: 'admin' | 'member' | 'guest') => {
    try { await S.createInvite(slug, email, r); setMsg(`Invitation sent to ${email.trim().toLowerCase()}`); await load(); return null; }
    catch (e) { return (e as Error).message; }
  };

  const header = (
    <div className='set-head-row'>
      <div>
        <h1 className='set-h1'>Members</h1>
        {rows && <p className='set-desc'>{rows.length} {rows.length === 1 ? 'member' : 'members'} in this workspace</p>}
      </div>
      {admin && <button ref={inviteBtn} type='button' className='set-btn' data-variant='primary' aria-haspopup='dialog' aria-expanded={inviteOpen} onClick={() => setInviteOpen((o) => !o)}>Invite</button>}
    </div>
  );
  if (err) return <SettingsShell slug={slug} current='members' header={<h1 className='set-h1'>Members</h1>}><p role='alert' className='set-error'>{err}</p></SettingsShell>;
  if (!rows) return <SettingsShell slug={slug} current='members' header={<h1 className='set-h1'>Members</h1>}><p role='status' className='set-muted'>Loading members…</p></SettingsShell>;

  return (
    <SettingsShell slug={slug} current='members' header={header}>
      <div data-testid='members-page'>
        {msg && <p role='status' className='toast'>{msg} <button type='button' className='set-btn' data-variant='ghost' onClick={() => setMsg(null)}>Dismiss</button></p>}
        <div className='set-toolbar'>
          <input type='search' className='set-input set-search' aria-label='Search members' placeholder='Search by name or email' value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <section aria-labelledby='mem-h' className='set-card set-flush'>
          <h2 id='mem-h' className='sr-only'>Members</h2>
          <table className='set-table'>
            <thead><tr><th scope='col'>Name</th><th scope='col'>Email</th><th scope='col'>Role</th><th scope='col'>State</th><th scope='col'><span className='sr-only'>Actions</span></th></tr></thead>
            <tbody>
              {shown.map((m) => {
                const name = nameFromEmail(m.email);
                const self = m.user_id === meId;
                const entries: MenuEntry[] = [
                  ...S.assignableRoles(role).map((r) => ({ id: `role-${r}`, label: `Make ${r}`, disabled: m.role === r, onSelect: () => void act(S.setMemberRole(slug, m.user_id, r), `${name} is now ${r}`) })),
                  { type: 'separator' as const },
                  { id: 'remove', label: 'Remove from workspace', destructive: true, onSelect: () => setRemoving(m) },
                ];
                return (
                  <tr key={m.user_id} data-testid='member-row'>
                    <td><span className='set-person'><UserAvatar userId={m.user_id} name={name} size='md' /><span className='set-person-text'>{name}{self && <span className='set-you'>you</span>}</span></span></td>
                    <td className='set-muted'>{m.email}</td>
                    <td>{admin && !self && m.role !== 'owner'
                      ? <select className='set-select set-role-select' aria-label={`Role for ${name}`} value={m.role}
                          onChange={(e) => void act(S.setMemberRole(slug, m.user_id, e.target.value as S.WorkspaceRole), `${name} is now ${e.target.value}`)}>
                          {ROLES.filter((r) => r !== 'admin' || role === 'owner' || m.role === 'admin').map((r) => <option key={r} value={r}>{cap(r)}</option>)}
                        </select>
                      : <span className='set-role' data-role={m.role}>{m.role}</span>}</td>
                    <td><span className='set-state'>Active</span></td>
                    <td className='set-end'>{admin && !self && S.canManageMember(role, m.role) && <RowMenu label={`Actions for ${name}`} entries={entries} />}</td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={5} className='set-empty'>No members match “{q}”.</td></tr>}
            </tbody>
          </table>
        </section>
        {admin && invites.length > 0 && (
          <section aria-labelledby='inv-h' className='set-section'>
            <h2 id='inv-h' className='set-h2'>Pending invitations <span className='set-key'>{invites.length}</span></h2>
            <div className='set-card set-flush'>
              <table className='set-table'>
                <thead><tr><th scope='col'>Email</th><th scope='col'>Role</th><th scope='col'>Expires</th><th scope='col'><span className='sr-only'>Actions</span></th></tr></thead>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id} data-testid='invite-row'>
                      <td>{i.email}</td>
                      <td><span className='set-role' data-role={i.role}>{i.role}</span></td>
                      <td className='set-muted'>{dateFmt.format(new Date(i.expires_at))}</td>
                      <td className='set-end'><RowMenu label={`Actions for invitation to ${i.email}`} entries={[
                        { id: 'resend', label: 'Resend invitation', onSelect: () => void act(S.resendInvite(slug, i.id), `Invitation resent to ${i.email}`) },
                        { type: 'separator' },
                        { id: 'revoke', label: 'Revoke invitation', destructive: true, onSelect: () => void act(S.revokeInvite(slug, i.id), `Invitation to ${i.email} revoked`) },
                      ]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <InvitePopover open={inviteOpen} anchorRef={inviteBtn} onClose={() => setInviteOpen(false)} roles={S.assignableRoles(role)} onSend={send} />
        <ConfirmDialog open={!!removing} destructive busy={busy} title={`Remove ${removing ? nameFromEmail(removing.email) : 'member'}?`} confirmLabel='Remove' onConfirm={() => void confirmRemove()} onCancel={() => setRemoving(null)}>
          {removing?.email} loses access to this workspace and is removed from all of its teams.
        </ConfirmDialog>
      </div>
    </SettingsShell>
  );
}

'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as S from '@/lib/settings-client';
import { personName } from '@/lib/nl-people';
import { ConfirmDialog, Popover, Select, UserAvatar, type MenuEntry } from '@/components/ui';
import { RowMenu } from '@/components/RowMenu';
import { SettingsShell } from '@/components/SettingsShell';
import { Icon } from '@/components/icons';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isAdmin = (r?: string) => r === 'owner' || r === 'admin';
type Tab = 'all' | 'admins' | 'members' | 'guests';
const TABS: { id: Tab; label: string; match: (r: string) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'admins', label: 'Admins', match: (r) => r === 'owner' || r === 'admin' },
  { id: 'members', label: 'Members', match: (r) => r === 'member' },
  { id: 'guests', label: 'Guests', match: (r) => r === 'guest' },
];
const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

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
        <label className='set-field'><span className='set-label'>Email addresses</span><input className='set-input' type='email' multiple required value={email} onChange={(e) => setEmail(e.target.value)} placeholder='name@company.com, other@company.com' /></label>
        <div className='set-field' role='radiogroup' aria-label='Role'>
          <span className='set-label' aria-hidden='true'>Role</span>
          <div className='set-seg'>
            {roles.map((r, i) => (
              <button key={r} type='button' role='radio' aria-checked={role === r} tabIndex={role === r ? 0 : -1} className='set-seg-btn'
                onClick={() => setRole(r as 'admin' | 'member' | 'guest')}
                onKeyDown={(e) => {
                  const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                  if (!d) return;
                  e.preventDefault();
                  const next = roles[(i + d + roles.length) % roles.length];
                  setRole(next as 'admin' | 'member' | 'guest');
                  (e.currentTarget.parentElement?.children[(i + d + roles.length) % roles.length] as HTMLElement | undefined)?.focus();
                }}>{cap(r)}</button>
            ))}
          </div>
        </div>
        {err && <p role='alert' className='set-error'>{err}</p>}
        <div className='set-actions'>
          <button type='button' className='btn' data-size='32' onClick={onClose}>Cancel</button>
          <button type='submit' className='btn' data-size='32' data-variant='primary' disabled={busy || !email.trim()}>Send invite</button>
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
  const [tab, setTab] = useState<Tab>('all');
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
  const tabDef = TABS.find((t) => t.id === tab) ?? TABS[0]!;
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, (rows ?? []).filter((m) => t.match(m.role)).length])) as Record<Tab, number>, [rows]);
  const shown = useMemo(() => (rows ?? []).filter((m) => tabDef.match(m.role) && S.matchesMember(m, personName(m), q)), [rows, q, tabDef]);
  const act = async (p: Promise<unknown>, ok: string) => { try { await p; setMsg(ok); await load(); } catch (e) { setMsg((e as Error).message); } };
  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    await act(S.removeMember(slug, removing.user_id), `Removed ${removing.email}`);
    setBusy(false); setRemoving(null);
  };
  const send = async (email: string, r: 'admin' | 'member' | 'guest') => {
    // Several addresses may be pasted, separated by commas or spaces: one invite each; the failures stay in the field.
    const list = Array.from(new Set(email.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)));
    const failed: string[] = []; let sent = 0, firstErr = '';
    for (const a of list) { try { await S.createInvite(slug, a, r); sent++; } catch (e) { failed.push(a); firstErr ||= (e as Error).message; } }
    if (sent) { setMsg(sent === 1 ? `Invitation sent to ${list.find((a) => !failed.includes(a))}` : `${sent} invitations sent`); await load(); }
    return failed.length ? `${failed.join(', ')}: ${firstErr}` : null;
  };

  const header = (
    <>
      <h1 className='set-h1'>Members</h1>
      {rows && <p className='set-desc'>{rows.length} {rows.length === 1 ? 'member' : 'members'} in this workspace</p>}
    </>
  );
  if (err) return <SettingsShell slug={slug} current='members' header={<h1 className='set-h1'>Members</h1>}><p role='alert' className='set-error'>{err}</p></SettingsShell>;
  if (!rows) return <SettingsShell slug={slug} current='members' header={<h1 className='set-h1'>Members</h1>}><p role='status' className='set-muted'>Loading members…</p></SettingsShell>;

  return (
    <SettingsShell slug={slug} current='members' header={header}>
      <div data-testid='members-page'>
        {msg && <p role='status' className='toast'>{msg} <button type='button' className='btn' data-size='32' data-variant='ghost' onClick={() => setMsg(null)}>Dismiss</button></p>}
        <div className='set-toolbar'>
          <input type='search' className='set-input set-search' aria-label='Search members' placeholder='Search by name or email' value={q} onChange={(e) => setQ(e.target.value)} />
          <div role='tablist' aria-label='Filter by role' className='set-tabs'>
            {TABS.map((t) => (
              <button key={t.id} type='button' role='tab' id={`mem-tab-${t.id}`} aria-selected={tab === t.id} aria-controls='mem-panel' tabIndex={tab === t.id ? 0 : -1} className='set-tab'
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!d) return;
                  e.preventDefault();
                  const n = TABS[(TABS.findIndex((x) => x.id === t.id) + d + TABS.length) % TABS.length]!;
                  setTab(n.id); document.getElementById(`mem-tab-${n.id}`)?.focus();
                }}>{t.label} <span className='set-tab-n'>{counts[t.id]}</span></button>
            ))}
          </div>
          {admin && <button ref={inviteBtn} type='button' className='btn set-invite-btn' data-size='32' data-variant='primary' aria-haspopup='dialog' aria-expanded={inviteOpen} onClick={() => setInviteOpen((o) => !o)}><Icon name='plus' size={14} />Invite</button>}
        </div>
        <section id='mem-panel' role='tabpanel' aria-labelledby={`mem-tab-${tab}`} className='set-card set-flush'>
                    <table className='set-table'>
            <thead><tr><th scope='col' className='set-col-name'>Name</th><th scope='col' className='set-col-email'>Email</th><th scope='col' className='set-col-role'>Role</th></tr></thead>
            <tbody>
              {shown.map((m) => {
                const name = personName(m);
                const self = m.user_id === meId;
                const manage = admin && !self && S.canManageMember(role, m.role);
                const entries: MenuEntry[] = [
                  { id: 'remove', label: 'Remove from workspace', destructive: true, onSelect: () => setRemoving(m) },
                ];
                return (
                  <tr key={m.user_id} data-testid='member-row'>
                    <td><span className='set-person'><UserAvatar userId={m.user_id} name={name} size='md' /><span className='set-person-text'>{name}{self && <span className='set-you'>you</span>}</span></span></td>
                    <td className='set-muted'>{m.email}</td>
                    <td>
                      <span className='set-role-cell'>
                        {manage
                          ? <Select className='set-select set-role-select' label={`Role for ${name}`} value={m.role} options={S.assignableRoles(role).map((r: S.AssignableRole) => ({ id: r, label: cap(r) }))}
                              onChange={(id) => void act(S.setMemberRole(slug, m.user_id, id as S.WorkspaceRole), `${name} is now ${id}`)} />
                          : <span className='set-role-text'>{cap(m.role)}</span>}
                        {manage && <RowMenu label={`Actions for ${name}`} entries={entries} />}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={3} className='set-empty'>{q ? <>No members match “{q}”.</> : `No ${tabDef.label.toLowerCase()} yet.`}</td></tr>}
            </tbody>
          </table>
        </section>
        {admin && invites.length > 0 && (
          <section aria-labelledby='inv-h' className='set-section'>
            <h2 id='inv-h' className='set-h2'>Pending invitations <span className='set-key'>{invites.length}</span></h2>
            <div className='set-card set-flush'>
              <table className='set-table'>
                <thead><tr><th scope='col' className='set-col-email'>Email</th><th scope='col' className='set-col-role'>Role</th><th scope='col' className='set-col-state'>Expires</th><th scope='col' className='set-col-end'><span className='sr-only'>Actions</span></th></tr></thead>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id} data-testid='invite-row'>
                      <td className='set-muted'>{i.email}</td>
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
        <ConfirmDialog open={!!removing} destructive busy={busy} title={`Remove ${removing ? personName(removing) : 'member'}?`} confirmLabel='Remove' onConfirm={() => void confirmRemove()} onCancel={() => setRemoving(null)}>
          {removing?.email} loses access to this workspace and is removed from all of its teams.
        </ConfirmDialog>
      </div>
    </SettingsShell>
  );
}

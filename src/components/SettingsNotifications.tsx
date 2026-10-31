'use client';
import { useEffect, useMemo, useState } from 'react';
import { httpInboxClient, NOTIF_TYPES, TYPE_LABEL, type PrefMap, type NotifType } from '@/lib/inbox-client';
import { SettingsShell } from '@/components/SettingsShell';
import { Checkbox } from '@/components/ui';

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
    <section aria-label='Notification preferences' className='set-section'>
      <div className='set-card'>
        <table className='set-table'>
          <thead><tr><th scope='col'>When someone…</th><th scope='col' className='set-center'>In app</th><th scope='col' className='set-center'>Email</th></tr></thead>
          <tbody>
            {NOTIF_TYPES.map((t) => (
              <tr key={t}>
                <td>{TYPE_LABEL[t]}</td>
                <td className='set-center'><Checkbox aria-label={`In-app: ${TYPE_LABEL[t]}`} checked={prefs[t].in_app} onChange={(e) => void set(t, 'in_app', e.target.checked)} /></td>
                <td className='set-center'><Checkbox aria-label={`Email: ${TYPE_LABEL[t]}`} checked={prefs[t].email} onChange={(e) => void set(t, 'email', e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}


export function SettingsNotifications({ slug }: { slug: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <SettingsShell slug={slug} current='notifications' header={<><h1 className='set-h1'>Notifications</h1><p className='set-desc'>Choose where you hear about activity that involves you.</p></>}>
      {msg && <p role='status' className='toast'>{msg}</p>}
      <NotificationPrefs slug={slug} onMsg={setMsg} />
    </SettingsShell>
  );
}

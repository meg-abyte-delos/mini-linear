'use client';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/icons';
import { hueFor, initialsOf } from '@/lib/member-hue';
import { nameFromEmail } from '@/lib/nl-people';

interface Row { id: string; user_id: string; email: string; role: string }

/** All pages of GET /api/v1/w/:slug/members (100 per call). */
async function loadAll(slug: string): Promise<Row[]> {
  const out: Row[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const r: Response = await fetch(`/api/v1/w/${slug}/members?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!r.ok) throw new Error(r.status === 403 ? 'You do not have access to this workspace.' : 'Could not load members');
    const j = (await r.json()) as { items?: Row[]; next_cursor?: string | null };
    out.push(...(j.items ?? []));
    cursor = j.next_cursor ?? null;
    if (!cursor) break;
  }
  return out;
}

// Read-only directory. The API has no deactivated state (removing a member deletes the membership), so every listed row is Active.
export function Members({ slug }: { slug: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadAll(slug).then(setRows).catch((e: Error) => setErr(e.message)); }, [slug]);
  if (err) return <main className='settings'><h1>Members</h1><p role='alert'>{err}</p></main>;
  if (!rows) return <main className='settings'><h1>Members</h1><p role='status'>Loading members…</p></main>;
  return (
    <main className='settings' data-testid='members-page'>
      <h1>Members</h1>
      <section aria-labelledby='mem-h' className='settings-card'>
        <h2 id='mem-h'>{rows.length} {rows.length === 1 ? 'member' : 'members'}</h2>
        <table>
          <thead><tr><th scope='col'>Name</th><th scope='col'>Email</th><th scope='col'>Role</th><th scope='col'>State</th></tr></thead>
          <tbody>
            {rows.map((m) => {
              const name = nameFromEmail(m.email);
              return (
                <tr key={m.user_id} data-testid='member-row'>
                  <td><Avatar initials={initialsOf(name)} hue={hueFor(m.user_id)} /> <span>{name}</span></td>
                  <td>{m.email}</td>
                  <td>{m.role}</td>
                  <td>Active</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}

'use client';
import { useEffect, useMemo, useState } from 'react';
import { byTarget, HEALTH_LABEL, newestFirst, projectClient, type Health, type Milestone, type ProjectDetail as Detail, type ProjectUpdate } from '@/lib/project-client';

interface Props { slug: string; projectId: string; canWrite: boolean; onBack: () => void; onViewIssues: (id: string) => void }

// Project detail: progress, milestones and status updates, on the project endpoints (API mode only).
export function ProjectDetail({ slug, projectId, canWrite, onBack, onViewIssues }: Props) {
  const client = useMemo(() => projectClient(slug, projectId), [slug, projectId]);
  const [proj, setProj] = useState<Detail | null>(null);
  const [ms, setMs] = useState<Milestone[]>([]);
  const [ups, setUps] = useState<ProjectUpdate[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>('on_track');
  const [body, setBody] = useState('');
  const [msName, setMsName] = useState('');
  const [msDate, setMsDate] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { const [p, m, u] = await Promise.all([client.get(), client.milestones(), client.updates()]); setProj(p); setMs(m); setUps(u); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not load the project'); }
  }
  useEffect(() => { void load(); }, [client]);

  async function run(f: () => Promise<unknown>) {
    setBusy(true);
    try { await f(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  }

  if (err && !proj) return <div className='state error' role='alert'><p>Could not load the project ({err}).</p><button onClick={onBack}>Back to projects</button></div>;
  if (!proj) return <div className='state' role='status'>Loading project…</div>;
  const pct = proj.progress_pct;
  return (
    <div className='scroll cycles pdetail' data-project={proj.id}>
      <div className='pd-head'>
        <button onClick={onBack}>← Projects</button>
        <h2>{proj.name}</h2>
        <span className='pd-status'>{proj.status.replace('_', ' ')}</span>
        {proj.health && <span className={`pd-health ${proj.health}`}>{HEALTH_LABEL[proj.health]}</span>}
        <button onClick={() => onViewIssues(proj.id)}>View issues</button>
      </div>
      {err && <p role='alert' className='pd-err'>{err}</p>}
      {proj.description && <p className='pd-desc'>{proj.description}</p>}
      <section aria-labelledby='pd-progress'>
        <h3 id='pd-progress'>Progress</h3>
        <span className='cy-prog' role='img' aria-label={`${pct}% complete, ${proj.done_count} of ${proj.issue_count} issues`}><span style={{ width: `${pct}%` }} /></span>
        <span className='cy-count'>{proj.done_count}/{proj.issue_count} ({pct}%)</span>
        <span className='cy-dates'>{proj.start_date ?? 'No start'} to {proj.target_date ?? 'no target'}</span>
      </section>
      <section aria-labelledby='pd-ms'>
        <h3 id='pd-ms'>Milestones <span className='count'>{ms.length}</span></h3>
        {ms.length === 0 ? <p className='col-empty'>No milestones</p> : <ul>{byTarget(ms).map((m) => <li key={m.id}><strong>{m.name}</strong> <span className='cy-dates'>{m.target_date ?? 'no date'}</span></li>)}</ul>}
        {canWrite && (
          <form onSubmit={(e) => { e.preventDefault(); const n = msName.trim(); if (!n) return; void run(async () => { await client.addMilestone(n, msDate || null); setMsName(''); setMsDate(''); }); }}>
            <input aria-label='Milestone name' placeholder='New milestone' value={msName} onChange={(e) => setMsName(e.target.value)} />
            <input aria-label='Milestone target date' type='date' value={msDate} onChange={(e) => setMsDate(e.target.value)} />
            <button type='submit' disabled={busy || !msName.trim()}>Add milestone</button>
          </form>
        )}
      </section>
      <section aria-labelledby='pd-up'>
        <h3 id='pd-up'>Updates <span className='count'>{ups.length}</span></h3>
        {canWrite && (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await client.addUpdate(health, body.trim()); setBody(''); }); }}>
            <select aria-label='Health' value={health} onChange={(e) => setHealth(e.target.value as Health)}>{(Object.keys(HEALTH_LABEL) as Health[]).map((h) => <option key={h} value={h}>{HEALTH_LABEL[h]}</option>)}</select>
            <textarea aria-label='Update' placeholder='Post an update' value={body} onChange={(e) => setBody(e.target.value)} />
            <button type='submit' disabled={busy}>Post update</button>
          </form>
        )}
        {ups.length === 0 ? <p className='col-empty'>No updates yet</p> : <ul>{newestFirst(ups).map((u) => <li key={u.id}><span className={`pd-health ${u.health}`}>{HEALTH_LABEL[u.health]}</span> <span className='cy-dates'>{u.created_at.slice(0, 10)}</span><p>{u.body}</p></li>)}</ul>}
      </section>
    </div>
  );
}

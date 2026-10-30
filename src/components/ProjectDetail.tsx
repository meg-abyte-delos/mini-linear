'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PROJECT_STATUSES, statusLabel, byTarget, HEALTH_LABEL, newestFirst, projectClient, type Health, type Milestone, type ProjectDetail as Detail, type ProjectUpdate } from '@/lib/project-client';
import { ProgressRing } from '@/components/ProgressRing';
import { EMPTY_PEOPLE, fetchNlPeople, type NlPeople } from '@/lib/nl-people';

export interface PdIssue { id: string; identifier: string; title: string; done: boolean }
interface Props { refreshKey?: number; issues?: PdIssue[]; leadName?: string | null; onOpenIssue?: (id: string) => void; slug: string; projectId: string; canWrite: boolean; onBack: () => void; onViewIssues: (id: string) => void }

// Project detail: progress, milestones and status updates, on the project endpoints (API mode only).
// Lead: proj.lead_id is a workspace member UUID, resolved via GET /me + /members (same source as Cmd+K and ProjectsList).
// The leadName prop (mock who()) is only a fallback when the member is not found.
export function ProjectDetail({ refreshKey = 0, slug, projectId, canWrite, onBack, onViewIssues, issues = [], leadName = null, onOpenIssue }: Props) {
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
  const [people, setPeople] = useState<NlPeople>(EMPTY_PEOPLE);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    setPeopleLoaded(false);
    void fetchNlPeople(slug).then((p) => { if (live) setPeople(p); }).finally(() => { if (live) setPeopleLoaded(true); });
    return () => { live = false; };
  }, [slug]);

  async function load() {
    try { const [p, m, u] = await Promise.all([client.get(), client.milestones(), client.updates()]); setProj(p); setMs(m); setUps(u); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not load the project'); }
  }
  useEffect(() => { void load(); }, [client]);
  // Realtime: an issue event (progress counts) bumps refreshKey; refetch quietly, coalescing bursts.
  const firstKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === firstKey.current) return;
    const t = setTimeout(() => { void load(); }, 300);
    return () => clearTimeout(t);
  }, [refreshKey]);

  async function run(f: () => Promise<unknown>) {
    setBusy(true);
    try { await f(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  }

  if (err && !proj) return <div className='state error' role='alert'><p>Could not load the project ({err}).</p><button onClick={onBack}>Back to projects</button></div>;
  if (!proj) return <div className='state' role='status'>Loading project…</div>;
  const pct = proj.progress_pct;
  // No 'Unknown' flash while members load: blank until resolved.
  const member = proj.lead_id ? people.users.find((u) => u.id === proj.lead_id) : undefined;
  const lead = !proj.lead_id ? (leadName ?? 'No lead') : member?.name ?? (leadName && leadName !== 'Unknown' ? leadName : peopleLoaded ? 'Unknown' : '\u00a0');
  return (
    <div className='scroll cycles pdetail' data-project={proj.id}>
      <div className='pd-head'>
        <button onClick={onBack}>← Projects</button>
        <h2>{proj.name}</h2>
        {canWrite ? (
          <select aria-label='Project status' className='pd-status' value={proj.status} disabled={busy} onChange={(e) => void run(() => client.patch(proj.version, { status: e.target.value }))}>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        ) : <span className='pd-status'>{statusLabel(proj.status)}</span>}
        {proj.health && <span className={`pd-health ${proj.health}`}>{HEALTH_LABEL[proj.health]}</span>}
        <button onClick={() => onViewIssues(proj.id)}>View issues</button>
      </div>
      {err && <p role='alert' className='pd-err'>{err}</p>}
      {proj.description && <p className='pd-desc'>{proj.description}</p>}
      <section aria-labelledby='pd-progress'>
        <h3 id='pd-progress'>Progress</h3>
        <ProgressRing pct={pct} size={28} showPct={false} label={`${pct}% complete, ${proj.done_count} of ${proj.issue_count} issues`} />
        <span className='cy-count'>{proj.done_count}/{proj.issue_count} ({pct}%)</span>
        <span className='cy-dates'>{proj.start_date ?? 'No start'} to {proj.target_date ?? 'no target'}</span>
        <p className='pd-meta'>Lead: <strong data-testid='pd-lead'>{lead}</strong>
          {canWrite && <label> Target date <input type='date' aria-label='Target date' value={proj.target_date ?? ''} disabled={busy} onChange={(e) => void run(() => client.patch(proj.version, { target_date: e.target.value || null }))} /></label>}
        </p>
      </section>
      <section aria-labelledby='pd-issues'>
        <h3 id='pd-issues'>Issues <span className='count'>{issues.length}</span></h3>
        {issues.length === 0 ? <p className='col-empty'>No issues in this project</p> : <ul className='pd-issues'>{issues.map((i) => <li key={i.id}><button onClick={() => onOpenIssue?.(i.id)}><span className='id'>{i.identifier}</span> <span className={i.done ? 'pd-done' : undefined}>{i.title}</span></button></li>)}</ul>}
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

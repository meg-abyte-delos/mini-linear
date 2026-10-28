'use client';
import { useState } from 'react';
import { USERS, fmtDate, type Issue, type ProjectMeta } from '@/lib/issues';
import { barFor, isOverdue, progress, roadmapRange, sortProjects, statusLabel, todayPct } from '@/lib/roadmap';

interface Props { projects: readonly ProjectMeta[]; issues: readonly Issue[]; today: string; canOpen: boolean; onOpen: (id: string) => void; onViewIssues: (id: string) => void }

export function ProjectsList({ projects, issues, today, canOpen, onOpen, onViewIssues }: Props) {
  const [mode, setMode] = useState<'list' | 'roadmap'>('list');
  const sorted = sortProjects(projects);
  const lead = (id?: string | null) => USERS.find((u) => u.id === id)?.name ?? (id ? 'Unknown' : 'No lead');
  const range = roadmapRange(sorted.map((p) => ({ start: p.start_date, end: p.target_date })));
  const tp = range ? todayPct(today, range) : null;
  return (
    <div className='scroll cycles'>
      <div className='pj-toggle' role='group' aria-label='Projects display'>
        <button aria-pressed={mode === 'list'} onClick={() => setMode('list')}>List</button>
        <button aria-pressed={mode === 'roadmap'} onClick={() => setMode('roadmap')}>Roadmap</button>
      </div>
      <section className='group' aria-labelledby='pj-all'>
        <h2 id='pj-all'><span>All projects</span><span className='count'>{projects.length}</span></h2>
        {sorted.length === 0 ? <p className='col-empty'>No projects</p> : mode === 'list' ? sorted.map((p) => {
          const pr = progress(issues.filter((i) => i.project_id === p.id));
          const late = isOverdue(p.target_date, p.status, today);
          return (
            <div key={p.id} className='cycle project pj-row' data-project={p.id}>
              <span className='cy-name'>{p.name}</span>
              <span className='pj-status' data-status={p.status ?? 'backlog'}>{statusLabel(p.status)}</span>
              <span className='cy-dates'>{lead(p.lead_id)}</span>
              <span className={`cy-dates${late ? ' pj-late' : ''}`} data-testid={`target-${p.id}`}>{p.target_date ? `Target ${fmtDate(p.target_date)}${late ? ' (overdue)' : ''}` : 'No target date'}</span>
              <span className='cy-prog' role='img' aria-label={`${pr.pct}% complete, ${pr.done} of ${pr.total} issues`}><span style={{ width: `${pr.pct}%` }} /></span>
              <span className='cy-count'>{pr.pct}%</span>
              {canOpen && <button onClick={() => onOpen(p.id)}>Open</button>}<button onClick={() => onViewIssues(p.id)}>View issues</button>
            </div>
          );
        }) : (
          <div className='rm' data-testid='roadmap'>
            {!range ? <p className='col-empty'>No project has a start or target date yet</p> : (
              <>
                <div className='rm-axis'><span>{fmtDate(range.from)}</span><span>{fmtDate(range.to)}</span></div>
                {sorted.map((p) => {
                  const bar = barFor({ start: p.start_date, end: p.target_date }, range);
                  const pr = progress(issues.filter((i) => i.project_id === p.id));
                  return (
                    <div key={p.id} className='rm-row' data-project={p.id}>
                      <span className='cy-name'>{p.name}</span>
                      <div className='rm-track'>
                        {tp !== null && <span className='rm-today' style={{ left: `${tp}%` }} aria-hidden='true' />}
                        {bar ? (
                          <span className='rm-bar' data-status={p.status ?? 'backlog'} role='img' style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                            aria-label={`${p.name}: ${p.start_date ? fmtDate(p.start_date) : '?'} to ${p.target_date ? fmtDate(p.target_date) : '?'}, ${pr.pct}% complete`}>
                            <span style={{ width: `${pr.pct}%` }} />
                          </span>
                        ) : <span className='rm-none'>No dates</span>}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

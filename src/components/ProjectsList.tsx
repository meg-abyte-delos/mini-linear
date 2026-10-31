'use client';
import { useEffect, useRef, useState } from 'react';
import { Avatar, Icon, PriorityIcon, ProjectStatusIcon, UnassignedIcon } from '@/components/icons';
import { EmptyState } from '@/components/ui';
import { ProgressRing } from '@/components/ProgressRing';
import { MOCK_PEOPLE, findPerson, type Person } from '@/lib/people';
import { fmtDate, type Issue, type ProjectMeta } from '@/lib/issues';
import { barFor, isOverdue, monthTicks, projectProgress, roadmapRange, timelineWidth, sortProjects, statusLabel, todayPct } from '@/lib/roadmap';

const HEALTH: Record<string, string> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };
const PRIO = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

interface Props { people?: readonly Person[]; projects: readonly ProjectMeta[]; issues: readonly Issue[]; today: string; canOpen: boolean; onOpen: (id: string) => void; onViewIssues: (id: string) => void }

export function ProjectsList({ people = MOCK_PEOPLE, projects, issues, today, canOpen, onOpen, onViewIssues }: Props) {
  const [mode, setMode] = useState<'list' | 'roadmap'>('list');
  const sorted = sortProjects(projects);
  const lead = (id?: string | null) => findPerson(people, id)?.name ?? 'No lead';
  const dated = sorted.some((p) => p.start_date || p.target_date);
  const range = dated ? roadmapRange([...sorted.map((p) => ({ start: p.start_date, end: p.target_date })), { start: today, end: today }]) : null;
  const tp = range ? todayPct(today, range) : null;
  const W = range ? timelineWidth(range) : 0;
  const todayPx = tp === null ? null : (tp / 100) * W;
  // Hide a month label whose text (about 72px from tick+6) would sit within 12px of the Today pill (about 48px wide).
  const ticks = (range ? monthTicks(range) : []).filter((t) => {
    if (todayPx === null) return true;
    const x = (t.leftPct / 100) * W + 6;
    return !(x < todayPx + 24 + 12 && x + 72 > todayPx - 24 - 12);
  });
  const gridTicks = range ? monthTicks(range) : [];
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || mode !== 'roadmap' || tp === null || !range) return;
    const x = 240 + (tp / 100) * timelineWidth(range);
    el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
  }, [mode, tp, range?.from, range?.to]);
  return (
    <div className='scroll cycles'>
      <div className='pj-toggle' role='group' aria-label='Projects display'>
        <button aria-pressed={mode === 'list'} onClick={() => setMode('list')}>List</button>
        <button aria-pressed={mode === 'roadmap'} onClick={() => setMode('roadmap')}>Roadmap</button>
      </div>
      <section className='group' aria-labelledby='pj-all'>
        <h2 id='pj-all'><span>All projects</span><span className='count'>{projects.length}</span></h2>
        {sorted.length === 0 ? <EmptyState compact icon='views' title='No projects' hint='Projects group issues around a shared goal and target date.' /> : mode === 'list' ? (
          <div className='pj-table' role='table' aria-label='Projects'>
            <div className='pj-head' role='row'>
              {['Name', 'Health', 'Priority', 'Lead', 'Target date', 'Issues', 'Status', 'Progress'].map((h) => <span key={h} role='columnheader'>{h}</span>)}
            </div>
            {sorted.map((p) => {
              const pr = projectProgress(p, issues.filter((i) => i.project_id === p.id));
              const late = isOverdue(p.target_date, p.status, today);
              const u = findPerson(people, p.lead_id);
              const prio = p.priority ?? 0;
              return (
                <div key={p.id} className='cycle project pj-row' role='row' data-project={p.id}>
                  <span className='cy-name' role='cell'>
                    <span className='pj-ic' aria-hidden='true'><Icon name='folder' size={14} /></span>
                    {canOpen ? <button className='pj-name' onClick={() => onOpen(p.id)}>{p.name}</button> : <span className='pj-name'>{p.name}</span>}
                    <span className='pj-actions'><button onClick={() => onViewIssues(p.id)}>View issues</button></span>
                  </span>
                  <span className='pj-health' role='cell' data-health={p.health ?? 'none'}><span className='pj-dot' aria-hidden='true' />{p.health ? HEALTH[p.health] : 'No updates'}</span>
                  <span className='pj-prio' role='cell' title={PRIO[prio]}><PriorityIcon priority={prio} /><span className='sr-only'>{PRIO[prio]}</span></span>
                  <span className='pj-lead' role='cell' title={lead(p.lead_id)}>{u ? <Avatar initials={u.initials} hue={u.hue} /> : <span className='av-wrap'><UnassignedIcon /></span>}<span className='pj-lead-t'>{u ? u.name : 'No lead'}</span></span>
                  <span className={`pj-date${late ? ' pj-late' : ''}`} role='cell' data-testid={`target-${p.id}`}>{p.target_date ? <><span className='sr-only'>Target </span>{fmtDate(p.target_date)}{late ? <span className='sr-only'> (overdue)</span> : null}</> : <span className='pj-none'>No date</span>}</span>
                  <span className='pj-issues' role='cell'>{pr.done}/{pr.total}</span>
                  <span className='pj-stat' role='cell'><ProjectStatusIcon status={p.status} /><span className='pj-status' data-status={p.status ?? 'backlog'}>{statusLabel(p.status)}</span></span>
                  <span className='pj-prog' role='cell' aria-label={`${pr.pct}% complete, ${pr.done} of ${pr.total} issues`}>
                    {/* SVG attributes, not inline style: the strict CSP drops style attributes. */}
                    <svg className='pj-bar' height='4' aria-hidden='true' focusable='false'><rect className='pj-track' width='100%' height='4' rx='2' /><rect className='pj-fill' data-done={pr.pct >= 100 || undefined} width={`${pr.pct}%`} height='4' rx='2' /></svg>
                    <span className='cy-count'>{pr.pct}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className='rm' data-testid='roadmap'>
            {!range ? (
              <div className='rm-empty'>
                <svg width='28' height='28' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.2' aria-hidden='true'><rect x='2' y='3' width='12' height='10' rx='1.5' /><path d='M2 6.5h12M5.5 2v2.5M10.5 2v2.5' /></svg>
                <p>No project has a start or target date yet</p>
              </div>
            ) : (
              <div className='rm-scroll' data-testid='rm-scroll' ref={scrollRef} tabIndex={0} role='region' aria-label='Roadmap timeline'>
                <div className='rm-inner' style={{ width: `calc(240px + ${timelineWidth(range)}px)` }}>
                  <div className='rm-head'>
                    <span className='rm-corner' />
                    <div className='rm-axis' data-testid='rm-axis' role='list' aria-label='Months'>
                      {ticks.map((t) => <span key={t.label} role='listitem' className='rm-tick' style={{ left: `${t.leftPct}%` }}>{t.label}</span>)}
                      {tp !== null && <span className='rm-pill' data-testid='rm-pill' style={{ left: `${tp}%` }}>Today</span>}
                    </div>
                  </div>
                  {sorted.map((p) => {
                    const bar = p.start_date && p.target_date ? barFor({ start: p.start_date, end: p.target_date }, range) : null;
                    const pr = projectProgress(p, issues.filter((i) => i.project_id === p.id));
                    const u = findPerson(people, p.lead_id);
                    return (
                      <div key={p.id} className='rm-row' data-project={p.id}>
                        <span className='rm-name'>{u ? <Avatar initials={u.initials} hue={u.hue} /> : <span className='av-wrap' title='No lead'><UnassignedIcon /></span>}<span className='rm-name-t'>{p.name}</span><ProgressRing pct={pr.pct} size={14} label={`${p.name} progress ${pr.pct}%`} /></span>
                        <div className='rm-track'>
                          {gridTicks.map((t) => <span key={t.label} className='rm-grid' style={{ left: `${t.leftPct}%` }} aria-hidden='true' />)}
                          {tp !== null && <span className='rm-today' data-testid='rm-today' style={{ left: `${tp}%` }} aria-hidden='true' />}
                          {bar ? (
                            <span className='rm-bar' data-status={p.status ?? 'backlog'} data-clip-start={bar.clipStart} data-clip-end={bar.clipEnd} role='img' style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                              aria-label={`${p.name}: ${fmtDate(p.start_date!)} to ${fmtDate(p.target_date!)}, ${pr.pct}% complete`}>
                              <span className='rm-fill' style={{ width: `${pr.pct}%` }} />
                              <span className='rm-label'>{p.name}</span>
                            </span>
                          ) : <span className='rm-none'>No dates</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

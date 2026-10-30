'use client';
import { Fragment, useState } from 'react';
import { fmtDate, type CycleMeta, type Issue } from '@/lib/issues';
import { cycleBucket, type CycleBucket } from '@/lib/filters';
import { cycleScope, cycleTiming } from '@/lib/cycles-ui';
import { isUuid } from '@/lib/api-client';
import { ProgressRing } from '@/components/ProgressRing';
import { CycleBurndown } from '@/components/CycleBurndown';
import { Icon } from '@/components/icons';
import '@/app/ui-cycles.css';

const BUCKETS: { id: CycleBucket; title: string; empty: string; hint: string }[] = [
  { id: 'active', title: 'Active', empty: 'No active cycles', hint: 'The current cycle shows up here once it starts.' },
  { id: 'upcoming', title: 'Upcoming', empty: 'No upcoming cycles', hint: 'Future cycles are created from the team cycle settings.' },
  { id: 'past', title: 'Past', empty: 'No past cycles', hint: 'Completed cycles are kept here with their final scope.' },
];

// Linear's cycle glyph: a circle with a quarter cut, drawn with SVG attributes only (strict CSP, no inline style).
function CycleGlyph({ bucket }: { bucket: CycleBucket }) {
  return (
    <svg className='cy-glyph' data-bucket={bucket} width='14' height='14' viewBox='0 0 14 14' aria-hidden='true'>
      <circle cx='7' cy='7' r='5.5' fill='none' strokeWidth='1.5' />
      {bucket !== 'upcoming' && <path d='M7 3.5A3.5 3.5 0 0 1 10.5 7H7z' />}
    </svg>
  );
}

interface Props { cycles: readonly CycleMeta[]; issues: readonly Issue[]; today: string; slug: string | null; onViewIssues: (cycleId: string) => void }

export function CyclesList({ cycles, issues, today, slug, onViewIssues }: Props) {
  const [burnOpen, setBurnOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setBurnOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className='scroll cycles'>
      {cycles.length === 0 && <div className='cy-empty'><CycleGlyph bucket='active' /><p className='col-empty'>No cycles yet</p><p className='cy-empty-hint'>Cycles are created from the team cycle settings.</p></div>}
      {BUCKETS.map((b) => {
        const cs = cycles.filter((c) => cycleBucket(c, today) === b.id);
        if (cs.length === 0) return null; // Linear hides empty groups
        return (
          <section key={b.id} className='group' aria-labelledby={`cy-${b.id}`}>
            <h2 id={`cy-${b.id}`}><span>{b.title}</span><span className='count'>{cs.length}</span></h2>
            {cs.length === 0 ? (
              <div className='cy-empty'><CycleGlyph bucket={b.id} /><p className='col-empty'>{b.empty}</p><p className='cy-empty-hint'>{b.hint}</p></div>
            ) : cs.map((c) => {
              // Progress ignores list filters on purpose; cycle_id already scopes issues to the cycle's team.
              const s = cycleScope(issues, c.id);
              const timing = cycleTiming(c, today, b.id);
              const bdOpen = burnOpen.has(c.id);
              return (
                <Fragment key={c.id}>
                  <div className='cycle' data-cycle={c.id} data-bucket={b.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onViewIssues(c.id); }}>
                    <span className='cy-name'><CycleGlyph bucket={b.id} /><button type='button' className='cy-title' aria-label={`View issues in ${c.name}`} onClick={() => onViewIssues(c.id)}>{c.name}</button>{b.id === 'active' && <span className='cy-badge'>Current</span>}</span>
                    <span className='cy-dates'>{fmtDate(c.start_date)} <span aria-hidden='true'>→</span><span className='sr-only'>to</span> {fmtDate(c.end_date)}{timing && <span className='cy-timing'>{timing}</span>}</span>
                    <span className='cy-scope'>
                      <span title='Scope'>{s.total} {s.total === 1 ? 'issue' : 'issues'}</span>
                      {b.id !== 'past' && <span className='cy-started' title='Started'>{s.started} started</span>}
                    </span>
                    <span className='cy-progress'>
                      <ProgressRing pct={s.pct} size={16} showPct={false} tone={b.id === 'past' && s.pct < 100 ? 'muted' : undefined} label={`${s.pct}% complete, ${s.done} of ${s.total} issues`} />
                      <span className='cy-pct'>{s.pct}%</span>
                      <span className='cy-count'>{s.done}/{s.total}</span>
                    </span>
                    <span className='cy-actions'>
                      {slug && isUuid(c.id) && <button aria-expanded={bdOpen} aria-controls={`bd-${c.id}`} aria-label={`${bdOpen ? 'Hide' : 'Show'} burndown for ${c.name}`} title='Burndown' onClick={() => toggle(c.id)}><Icon name='chart' /></button>}
                    </span>
                  </div>
                  {bdOpen && slug && <div id={`bd-${c.id}`}><CycleBurndown slug={slug} cycleId={c.id} name={c.name} today={today} /></div>}
                </Fragment>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

import type { Status, Issue } from '@/lib/issues';

// Status: 14px, 1.5 ring, Linear-style inner pie (r=3) for partial states.
const pie = (f: number) => { const a = 2 * Math.PI * f; const x = 7 + 3 * Math.sin(a); const y = 7 - 3 * Math.cos(a); return `M7 7V4A3 3 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`; };

export function StatusIcon({ status }: { status: Status }) {
  return (
    <svg className={`si si-${status}`} width='14' height='14' viewBox='0 0 14 14' aria-hidden='true' focusable='false'>
      {status === 'backlog' && <circle cx='7' cy='7' r='6' fill='none' strokeWidth='1.5' strokeDasharray='1.4 1.75' />}
      {status === 'todo' && <circle cx='7' cy='7' r='6' fill='none' strokeWidth='1.5' />}
      {status === 'in_progress' && (<><circle cx='7' cy='7' r='6' fill='none' strokeWidth='1.5' /><path d={pie(0.5)} className='fill' /></>)}
      {status === 'in_review' && (<><circle cx='7' cy='7' r='6' fill='none' strokeWidth='1.5' /><path d={pie(0.75)} className='fill' /></>)}
      {status === 'done' && (<><circle cx='7' cy='7' r='6.75' className='fill' stroke='none' /><path d='M4.5 7.1 6.3 8.9 9.6 5.4' fill='none' stroke='var(--bg, #08090a)' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' /></>)}
      {status === 'canceled' && (<><circle cx='7' cy='7' r='6.75' className='fill' stroke='none' /><path d='M5 5 9 9M9 5 5 9' fill='none' stroke='var(--bg, #08090a)' strokeWidth='1.5' strokeLinecap='round' /></>)}
    </svg>
  );
}

// Priority: Linear bars (3 x 3px, heights 4/7/10, baseline 12), urgent = rounded square with "!".
export function PriorityIcon({ priority }: { priority: Issue['priority'] }) {
  if (priority === 0) return (<svg className='pi' width='14' height='14' viewBox='0 0 14 14' aria-hidden='true' focusable='false'><g className='dimfill'><rect x='1.5' y='6.25' width='2.5' height='1.5' rx='.5' /><rect x='5.75' y='6.25' width='2.5' height='1.5' rx='.5' /><rect x='10' y='6.25' width='2.5' height='1.5' rx='.5' /></g></svg>);
  if (priority === 1) return (<svg className='pi pi-urgent' width='14' height='14' viewBox='0 0 14 14' aria-hidden='true' focusable='false'><rect x='1' y='1' width='12' height='12' rx='3' className='fill' /><path d='M7 3.8v3.9' stroke='var(--bg, #08090a)' strokeWidth='1.6' strokeLinecap='round' /><circle cx='7' cy='10.1' r='.95' fill='var(--bg, #08090a)' /></svg>);
  const n = 5 - priority;
  return (
    <svg className='pi' width='14' height='14' viewBox='0 0 14 14' aria-hidden='true' focusable='false'>
      {[0, 1, 2].map((k) => (<rect key={k} x={1.5 + k * 4.25} y={8 - k * 3} width='2.75' height={4 + k * 3} rx='.75' className={k < n ? 'on' : 'dim'} />))}
    </svg>
  );
}

export function Avatar({ initials, hue }: { initials: string; hue: string }) {
  return <span className={`av ${hue}`} aria-hidden='true'>{initials}</span>;
}

// Lucide-derived paths (24 viewBox, 1.5 stroke), rendered at 14px.
const PATHS = {
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z',
  issues: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM9 12l2 2 4-4',
  views: 'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  board: 'M3 3h7v18H3ZM14 3h7v11h-7Z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM21 21l-4.35-4.35',
  team: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
  filter: 'M3 6h18M7 12h10M10 18h4',
  display: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4',
  cycle: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5',
  compose: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (<svg className='ic' width={size} height={size} viewBox='0 0 24 24' fill='none' strokeWidth='1.75' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'><path d={PATHS[name]} /></svg>);
}

// Unassigned: dashed ring + head/shoulders, same footprint as Avatar.
export function UnassignedIcon({ title }: { title?: string }) {
  return (<svg className='av-none-ic' width='16' height='16' viewBox='0 0 16 16' fill='none' aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} focusable='false'>{title && <title>{title}</title>}<circle cx='8' cy='8' r='7.25' strokeWidth='1.2' strokeDasharray='2 1.6' /><circle cx='8' cy='6.4' r='2' strokeWidth='1.2' /><path d='M4.6 11.6a3.8 3.8 0 0 1 6.8 0' strokeWidth='1.2' strokeLinecap='round' /></svg>);
}

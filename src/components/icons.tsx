import type { Status, Issue } from '@/lib/issues';

export function StatusIcon({ status }: { status: Status }) {
  return (
    <svg className={`si si-${status}`} width='14' height='14' viewBox='0 0 14 14' aria-hidden='true' focusable='false'>
      {status === 'backlog' && <circle cx='7' cy='7' r='5.5' fill='none' strokeWidth='1.5' strokeDasharray='2 2' />}
      {status === 'todo' && <circle cx='7' cy='7' r='5.5' fill='none' strokeWidth='1.5' />}
      {status === 'in_progress' && (<><circle cx='7' cy='7' r='5.5' fill='none' strokeWidth='1.5' /><path d='M7 3.5 A3.5 3.5 0 0 1 7 10.5 Z' className='fill' /></>)}
      {status === 'in_review' && (<><circle cx='7' cy='7' r='5.5' fill='none' strokeWidth='1.5' /><path d='M7 7 V3.5 A3.5 3.5 0 1 1 3.5 7 Z' className='fill' /></>)}
      {status === 'done' && (<><circle cx='7' cy='7' r='6.5' className='fill' stroke='none' /><path d='M4.2 7.2 6.2 9.1 9.8 5.2' fill='none' stroke='#fff' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' /></>)}
      {status === 'canceled' && (<><circle cx='7' cy='7' r='6.5' className='fill' stroke='none' /><path d='M4.8 4.8 9.2 9.2 M9.2 4.8 4.8 9.2' fill='none' stroke='#fff' strokeWidth='1.5' strokeLinecap='round' /></>)}
    </svg>
  );
}

export function PriorityIcon({ priority }: { priority: Issue['priority'] }) {
  if (priority === 0) return (<svg className='pi' width='14' height='14' viewBox='0 0 14 14' aria-hidden='true' focusable='false'><path d='M2 7h2.5M5.8 7h2.5M9.5 7H12' strokeWidth='1.5' strokeLinecap='round' fill='none' className='dimline' /></svg>);
  if (priority === 1) return (<svg className='pi pi-urgent' width='14' height='14' viewBox='0 0 14 14' aria-hidden='true' focusable='false'><rect x='1.5' y='1.5' width='11' height='11' rx='2.5' className='fill' /><path d='M7 4v3.8' stroke='#fff' strokeWidth='1.5' strokeLinecap='round' /><circle cx='7' cy='10' r='.9' fill='#fff' /></svg>);
  const n = 5 - priority;
  return (
    <svg className='pi' width='14' height='14' viewBox='0 0 14 14' aria-hidden='true' focusable='false'>
      {[0, 1, 2].map((k) => (<rect key={k} x={2 + k * 4} y={9 - k * 3} width='2.4' height={3 + k * 3} rx='.6' className={k < n ? 'on' : 'dim'} />))}
    </svg>
  );
}

export function Avatar({ initials, hue }: { initials: string; hue: string }) {
  return <span className={`av ${hue}`} aria-hidden='true'>{initials}</span>;
}

const PATHS = {
  inbox: 'M2.5 8.5 4 3h8l1.5 5.5V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1ZM2.5 8.5H5.5l.5 1.5h4l.5-1.5h3',
  issues: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM5.5 8l1.8 1.8L10.8 6',
  views: 'M2.5 4h11M2.5 8h11M2.5 12h7',
  list: 'M5 4h8M5 8h8M5 12h8M2.5 4h.1M2.5 8h.1M2.5 12h.1',
  board: 'M2.5 3h3.5v10H2.5ZM7 3h3.5v6H7ZM11.5 3H15v8h-3.5Z',
  plus: 'M8 3v10M3 8h10',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.5 10.5 14 14',
  team: 'M8 2.5 13.5 5.5v5L8 13.5 2.5 10.5v-5Z',
} as const;

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (<svg className='ic' width='16' height='16' viewBox='0 0 16 16' fill='none' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'><path d={PATHS[name]} /></svg>);
}

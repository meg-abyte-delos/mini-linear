'use client';
import { useEffect, useState } from 'react';

// Burndown chart for one cycle: remaining work (teal line), ideal (dashed), scope (dim step line).
// Geometry is SVG attributes only (no inline styles: strict CSP); colors come from ui-burndown.css (Delos Night tokens).
export interface BurnPoint { day: string; scope: number | null; done: number | null; remaining: number | null; ideal: number }

const W = 640, H = 180, L = 36, R = 12, T = 12, B = 26;

export function BurndownChart({ points, label }: { points: BurnPoint[]; label: string }) {
  const n = points.length;
  if (n === 0) return <p className='bd-empty'>No data for this cycle.</p>;
  const maxY = Math.max(1, ...points.map((p) => Math.max(p.scope ?? 0, p.ideal)));
  const x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (1 - v / maxY) * (H - T - B);
  const path = (get: (p: BurnPoint) => number | null, step = false) => {
    let d = '', prev: number | null = null;
    points.forEach((p, i) => {
      const v = get(p);
      if (v === null) return;
      d += d === '' ? `M${x(i)} ${y(v)}` : step && prev !== null ? `H${x(i)}V${y(v)}` : `L${x(i)} ${y(v)}`;
      prev = v;
    });
    return d;
  };
  const ticks = Array.from(new Set([0, Math.round(maxY / 2), maxY]));
  const last = [...points].reverse().find((p) => p.remaining !== null);
  const every = Math.max(1, Math.ceil(n / 7));
  return (
    <svg className='bd-svg' viewBox={`0 0 ${W} ${H}`} role='img' aria-label={label} data-testid='burndown-chart'>
      {ticks.map((t) => (
        <g key={t}>
          <line className='bd-grid' x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
          <text className='bd-tick' x={L - 6} y={y(t) + 4} textAnchor='end'>{t}</text>
        </g>
      ))}
      {points.map((p, i) => (i % every === 0 || i === n - 1) && (
        <text key={p.day} className='bd-tick' x={x(i)} y={H - 8} textAnchor='middle'>{p.day.slice(5)}</text>
      ))}
      <path className='bd-scope' d={path((p) => p.scope, true)} fill='none' />
      <path className='bd-ideal' d={path((p) => p.ideal)} fill='none' strokeDasharray='5 4' />
      <path className='bd-line' d={path((p) => p.remaining)} fill='none' strokeLinejoin='round' strokeLinecap='round' />
      {last && <circle className='bd-dot' cx={x(points.indexOf(last))} cy={y(last.remaining as number)} r={3.5} />}
    </svg>
  );
}

export function CycleBurndown({ slug, cycleId, name, today }: { slug: string; cycleId: string; name: string; today: string }) {
  const [points, setPoints] = useState<BurnPoint[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/v1/w/${slug}/cycles/${cycleId}/burndown?on=${today}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { points: BurnPoint[] }) => { if (live) setPoints(j.points); })
      .catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [slug, cycleId, today]);
  if (err) return <p className='bd-empty' role='alert'>Could not load the burndown.</p>;
  if (!points) return <p className='bd-empty' role='status'>Loading burndown…</p>;
  const last = [...points].reverse().find((p) => p.remaining !== null);
  const label = `Burndown for ${name}: ${last ? `${last.remaining} of ${last.scope} issues remaining on ${last.day}` : 'not started'}`;
  return (
    <div className='bd' data-cycle-burndown={cycleId}>
      <BurndownChart points={points} label={label} />
      <div className='bd-legend' aria-hidden='true'><span className='bd-k bd-k-line'>Remaining</span><span className='bd-k bd-k-ideal'>Ideal</span><span className='bd-k bd-k-scope'>Scope</span></div>
    </div>
  );
}

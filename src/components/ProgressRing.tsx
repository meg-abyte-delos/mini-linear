'use client';
import { useId } from 'react';

// Progress ring: a 2-circle SVG (track + gradient arc). Geometry is set with SVG attributes only
// (pathLength=100 + strokeDasharray), never inline styles, so the strict CSP (style-src 'self') keeps it.
// Butt caps keep the arc length equal to the percentage (round caps overdraw small values).
// Colors come from ui-rings.css (stop-color / stroke), driven by the Delos Night tokens.
interface Props { pct: number; size?: number; label: string; showPct?: boolean; tone?: 'accent' | 'muted' | 'done' }

export function ProgressRing({ pct, size = 16, label, showPct = true, tone }: Props) {
  const p = Math.max(0, Math.min(100, Math.round(Number.isFinite(pct) ? pct : 0)));
  const gid = `rg${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const t = tone ?? (p >= 100 ? 'done' : 'accent');
  return (
    <span className='ring' data-tone={t} data-size={size >= 24 ? 'lg' : 'sm'}>
      <svg className='ring-svg' width={size} height={size} viewBox='0 0 20 20' role='img' aria-label={label}>
        <defs>
          <linearGradient id={gid} x1='0' y1='0' x2='1' y2='1'>
            <stop className='ring-s0' offset='0%' />
            <stop className='ring-s1' offset='100%' />
          </linearGradient>
        </defs>
        <circle className='ring-track' cx='10' cy='10' r='8' fill='none' strokeWidth='2.5' />
        {p > 0 && (
          <circle className='ring-arc' cx='10' cy='10' r='8' fill='none' strokeWidth='2.5' strokeLinecap='butt'
            pathLength={100} strokeDasharray={`${p} 100`} transform='rotate(-90 10 10)' stroke={`url(#${gid})`} />
        )}
      </svg>
      {showPct && <span className='ring-pct' aria-hidden='true'>{p}%</span>}
    </span>
  );
}

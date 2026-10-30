// Anchored placement with flip + clamp. Pure so it can be unit-tested.
export interface Box { top: number; left: number; width: number; height: number }
export type Side = 'bottom' | 'top';
export type Align = 'start' | 'end';
export function place(anchor: Box, size: { width: number; height: number }, view: { width: number; height: number }, side: Side = 'bottom', align: Align = 'start', gap = 4, pad = 8): { top: number; left: number; side: Side } {
  const below = view.height - (anchor.top + anchor.height) - gap - pad;
  const above = anchor.top - gap - pad;
  let s = side;
  if (s === 'bottom' && size.height > below && above > below) s = 'top';
  else if (s === 'top' && size.height > above && below > above) s = 'bottom';
  const top = s === 'bottom' ? anchor.top + anchor.height + gap : anchor.top - gap - size.height;
  const rawLeft = align === 'start' ? anchor.left : anchor.left + anchor.width - size.width;
  const left = Math.min(Math.max(rawLeft, pad), Math.max(view.width - size.width - pad, pad));
  return { top: Math.max(top, pad), left, side: s };
}

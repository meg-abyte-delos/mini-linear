'use client';
import { useEffect, useState } from 'react';

// Keeps a node mounted while its exit animation plays. `state` drives data-state='open'|'closed' in CSS.
// With reduced motion it unmounts immediately; the timeout is the safety net for the animation end.
export function useExitMount(open: boolean, fallbackMs = 240) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setMounted(false); return; }
    const t = setTimeout(() => setMounted(false), fallbackMs);
    return () => clearTimeout(t);
  }, [open, fallbackMs]);
  return { mounted: open || mounted, state: open ? 'open' : 'closed' } as const;
}

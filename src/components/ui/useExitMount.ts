'use client';
import { useEffect, useState } from 'react';
import { durMs } from './motion';

// Keeps a node mounted while its exit animation plays. `state` drives data-state='open'|'closed' in CSS.
// With reduced motion it unmounts immediately; the timeout is the safety net for the animation end.
// The exit animation runs for --dur-fast (see ui-primitives.css), so that plus a small margin is the default.
const EXIT_MARGIN_MS = 40;

export function useExitMount(open: boolean, fallbackMs?: number) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setMounted(false); return; }
    const t = setTimeout(() => setMounted(false), fallbackMs ?? durMs('--dur-fast') + EXIT_MARGIN_MS);
    return () => clearTimeout(t);
  }, [open, fallbackMs]);
  return { mounted: open || mounted, state: open ? 'open' : 'closed' } as const;
}

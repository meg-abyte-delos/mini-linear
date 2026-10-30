'use client';
import { useLayoutEffect, type RefObject } from 'react';

// CSP style-src 'self' blocks style="" attributes in server-rendered HTML but allows CSSOM writes.
// Dynamic geometry goes through custom properties set here (before paint), consumed by a CSS class.
export function useCssVars(ref: RefObject<HTMLElement | null>, vars: Record<string, string | number>): void {
  const key = JSON.stringify(vars);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const [k, v] of Object.entries(JSON.parse(key) as Record<string, string | number>)) el.style.setProperty(k, String(v));
  }, [ref, key]);
}

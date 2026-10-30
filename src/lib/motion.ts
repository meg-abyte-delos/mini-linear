import { flushSync } from 'react-dom';

/** Runs a view switch inside a View Transition (cross-fade timed by --dur-base in CSS).
 * Falls back to a plain update when unsupported or when the user prefers reduced motion. */
export function withViewTransition(update: () => void) {
  const doc = typeof document !== 'undefined' ? (document as Document & { startViewTransition?: (cb: () => void) => unknown }) : null;
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!doc?.startViewTransition || reduce) { update(); return; }
  doc.startViewTransition(() => flushSync(update));
}

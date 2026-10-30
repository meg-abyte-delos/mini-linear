// JS side of the motion tokens (src/app/tokens.css, #187). Durations are read from the live --dur-* custom properties so
// they follow the tokens (including the reduced-motion override to 0ms); the fallbacks mirror tokens.css and only apply
// when the variable is missing (SSR, tests).
const FALLBACK_MS = { '--dur-instant': 80, '--dur-fast': 120, '--dur-base': 160, '--dur-slow': 200 } as const;
export type DurToken = keyof typeof FALLBACK_MS;

export function durMs(token: DurToken): number {
  if (typeof window === 'undefined') return FALLBACK_MS[token];
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return FALLBACK_MS[token];
  return raw.endsWith('ms') ? n : raw.endsWith('s') ? n * 1000 : FALLBACK_MS[token];
}

// Hover intent before a tooltip opens. A behaviour delay, not an animation, so it has no --dur token.
export const TOOLTIP_DELAY_MS = 400;

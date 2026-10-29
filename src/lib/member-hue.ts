// Stable avatar hue for API members (no hue column): FNV-1a hash of the id over the palette
// the USERS mock already uses, so a given member keeps the same colour everywhere.
import { USERS } from '@/lib/issues';

export type Hue = (typeof USERS)[number]['hue'];
const HUES: readonly Hue[] = Array.from(new Set(USERS.map((u) => u.hue)));

export function hueFor(id: string): Hue {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return HUES[h % HUES.length]!;
}

export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

// One stable color per user: hash the id into a fixed palette slot (CSS maps av-c0..av-c7 to tokens).
export const AVATAR_SLOTS = 8;
export function avatarSlot(userId: string): number {
  let h = 2166136261;
  for (let k = 0; k < userId.length; k++) { h ^= userId.charCodeAt(k); h = Math.imul(h, 16777619); }
  return (h >>> 0) % AVATAR_SLOTS;
}
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return [...(parts[0] ?? '')].slice(0, 2).join('').toUpperCase();
  return ((Array.from(parts[0] ?? '')[0] ?? '') + (Array.from(parts[parts.length - 1] ?? '')[0] ?? '')).toUpperCase();
}

// Fixed ids of the demo seed, shared by scripts/seed-demo.mts and the e2e specs (no side effects here).
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const DEMO = { slug: 'demo', teamKey: 'DEM' } as const;
export const USERS = {
  admin: { id: id(2), email: 'demo@example.test', name: 'Demo Admin' },
  mate: { id: id(7), email: 'mate@example.test', name: 'Ada Kernel' },
  // Own persona for the inbox specs: not assignee/creator/subscriber of anything, so parallel specs never add notifications to its inbox.
  inbox: { id: id(9), email: 'inbox@example.test', name: 'Inbox Tester' },
  guest: { id: id(8), email: 'guest@example.test', name: 'Guest Viewer' },
} as const;
export const TEAM = id(3);
export const PROJECTS = { p1: id(4), p2: id(40) } as const; // p1 Mini Linear, p2 Cronkit
export const CYCLES = { c1: id(5), c2: id(50), c3: id(51) } as const; // past, active and upcoming on 2026-10-27 (the e2e test clock)
export const LABELS = { infra: id(60), bug: id(61), feature: id(62) } as const;

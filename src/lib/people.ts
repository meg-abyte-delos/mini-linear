// People directory for pickers and names. API mode: workspace members (GET /me + /members via nl-people);
// mock mode: the USERS fixtures. Ids are real member UUIDs in API mode.
import { USERS } from '@/lib/issues';
import type { NlPeople } from '@/lib/nl-people';

export interface Person { id: string; name: string; initials: string; hue: string }

export function initialsOf(name: string): string {
  const w = name.split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return ((w[0]![0] ?? '') + (w.length > 1 ? (w[w.length - 1]![0] ?? '') : (w[0]![1] ?? ''))).toUpperCase();
}

/** Stable hue h1..h5 from the id, so a person keeps one colour everywhere. */
export function hueOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `h${(h % 5) + 1}`;
}

export const MOCK_PEOPLE: readonly Person[] = USERS.map((u) => ({ id: u.id, name: u.name, initials: u.initials, hue: u.hue }));

export function peopleFromNl(p: NlPeople): Person[] {
  return p.users.map((u) => ({ id: u.id, name: u.name, initials: initialsOf(u.name), hue: hueOf(u.id) }));
}

export const findPerson = (people: readonly Person[], id: string | null | undefined): Person | undefined => (id ? people.find((p) => p.id === id) : undefined);

// People directory for pickers and names. API mode: workspace members (GET /me + /members via nl-people);
// mock mode: the USERS fixtures. Ids are real member UUIDs in API mode.
import { USERS } from '@/lib/issues';
import { hueFor, initialsOf } from '@/lib/member-hue';
import type { NlPeople } from '@/lib/nl-people';

export interface Person { id: string; name: string; initials: string; hue: string }


export const MOCK_PEOPLE: readonly Person[] = USERS.map((u) => ({ id: u.id, name: u.name, initials: u.initials, hue: u.hue }));

export function peopleFromNl(p: NlPeople): Person[] {
  return p.users.map((u) => ({ id: u.id, name: u.name, initials: initialsOf(u.name), hue: hueFor(u.id) }));
}

export const findPerson = (people: readonly Person[], id: string | null | undefined): Person | undefined => (id ? people.find((p) => p.id === id) : undefined);

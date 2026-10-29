import { listIssues } from '@/lib/sim-store';
import { apiConfig } from '@/lib/remote';
import { SearchView } from '@/components/SearchView';
import type { HitKind } from '@/lib/search-client';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const KINDS = ['issue', 'comment', 'project'];

/** /search?q=&kind=: full results page (Area 8). API mode searches the workspace; mock mode matches the seeded issues. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const api = apiConfig();
  const kind = one(sp.kind);
  const issues = api ? [] : await listIssues();
  return <SearchView initialQuery={one(sp.q).slice(0, 200)} initialKind={KINDS.includes(kind) ? (kind as HitKind) : null} slug={api?.slug ?? null} mockIssues={issues} />;
}

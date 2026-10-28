import { listIssues, parseSimState } from '@/lib/mock-api';
import { Shell } from '@/components/Shell';
import { parseFilters, TODAY_RE } from '@/lib/filters';
import { seedIssues, MOCK_META, type Issue, type Meta } from '@/lib/issues';
import { apiConfig, loadRemote, loadRole } from '@/lib/remote';

const parseView = (v: string | string[] | undefined) => { const x = Array.isArray(v) ? v[0] : v; return x === 'board' || x === 'cycles' || x === 'projects' ? x : 'list'; };

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const sim = parseSimState(sp.state);
  // Perf fixture: never in production, unless the e2e server opts in explicitly (PERF_SEED=1).
  const seedAllowed = process.env.NODE_ENV !== 'production' || process.env.PERF_SEED === '1';
  const seed = !seedAllowed ? 0 : Number(Array.isArray(sp.seed) ? sp.seed[0] : sp.seed) || 0;
  // ?today= is a test clock: honoured only outside production (or with PERF_SEED=1 for the e2e server).
  const todayParam = !seedAllowed ? undefined : Array.isArray(sp.today) ? sp.today[0] : sp.today;
  const today = todayParam && TODAY_RE.test(todayParam) ? todayParam : new Date().toISOString().slice(0, 10);
  let issues: Issue[] = [];
  let error: string | null = null;
  let meta: Meta = MOCK_META;
  let truncated = false;
  const api = apiConfig();
  // API mode: read-only is derived from the session role (guest); ?role=guest stays a test hook for mock mode only, never in production.
  let readOnly = seedAllowed && !api && (Array.isArray(sp.role) ? sp.role[0] : sp.role) === 'guest';
  try {
    if (api && !sim) readOnly = (await loadRole(api)) === 'guest';
    if (api && !sim) ({ issues, meta, truncated } = await loadRemote(api)); else issues = await listIssues(sim);
    if (seed > 0 && !sim) issues = [...issues, ...seedIssues(seed)]; } catch (e) {
    // Log the real cause server-side only; the UI gets a fixed, user-safe message.
    console.error('listIssues failed:', e instanceof Error ? e.message : e);
    error = 'Could not load issues';
  }
  return <Shell key={error ? "error" : sim ?? "ok"} initialIssues={issues} loadError={error} truncated={truncated} initialFilters={parseFilters(sp, meta, !!api)} meta={meta} api={api} today={today} initialView={parseView(sp.view)} readOnly={readOnly} initialIssueId={Array.isArray(sp.issue) ? sp.issue[0] : sp.issue} />;
}

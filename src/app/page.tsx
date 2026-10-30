import { listIssues, parseSimState } from '@/lib/sim-store';
import { Shell } from '@/components/Shell';
import { parseFilters, TODAY_RE } from '@/lib/filters';
import { seedIssues, MOCK_META, type Issue, type Meta } from '@/lib/issues';
import { redirect } from 'next/navigation';
import { loadRemote, loadRole, HttpError } from '@/lib/remote';
import { getWorkspaceContext, problemFor } from '@/lib/auth/workspace-context';
import { WorkspaceState } from '@/components/WorkspaceState';

const parseView = (v: string | string[] | undefined) => { const x = Array.isArray(v) ? v[0] : v; return x === 'board' || x === 'cycles' || x === 'projects' || x === 'inbox' ? x : 'list'; };

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  // ?state= (loading/error/empty simulation) is a dev/test hook backed by the mock: never in a production build.
  const sim = process.env.NODE_ENV !== 'production' ? parseSimState(sp.state) : null;
  // Perf fixture: never in production, unless the e2e server opts in explicitly (PERF_SEED=1).
  const seedAllowed = process.env.NODE_ENV !== 'production' || process.env.PERF_SEED === '1';
  const seed = !seedAllowed ? 0 : Number(Array.isArray(sp.seed) ? sp.seed[0] : sp.seed) || 0;
  // ?today= is a test clock: honoured only outside production (or with PERF_SEED=1 for the e2e server).
  const todayParam = !seedAllowed ? undefined : Array.isArray(sp.today) ? sp.today[0] : sp.today;
  const today = todayParam && TODAY_RE.test(todayParam) ? todayParam : new Date().toISOString().slice(0, 10);
  let issues: Issue[] = [];
  let unauthenticated = false;
  let error: string | null = null;
  let meta: Meta = MOCK_META;
  let truncated = false;
  // API is the only mode. No session -> getWorkspaceContext redirects to /login. Any other failure gets a dedicated page, not the generic Next error.
  let api: Awaited<ReturnType<typeof getWorkspaceContext>>;
  try { api = await getWorkspaceContext(); } catch (e) {
    if (!(e instanceof HttpError)) throw e; // includes Next's redirect signal
    console.error('getWorkspaceContext failed:', e.message);
    return <WorkspaceState problem={problemFor(e.status)} />;
  }
  // Read-only is derived from the session role (guest).
  let readOnly = false;
  try {
    if (!sim) readOnly = (await loadRole(api)) === 'guest';
    if (!sim) ({ issues, meta, truncated } = await loadRemote(api)); else issues = await listIssues(sim);
    // Perf fixture lives in the home team: the team scope is strict (no team_id = hidden).
    if (seed > 0 && !sim) issues = [...issues, ...seedIssues(seed).map((i) => ({ ...i, team_id: api.teamId }))]; } catch (e) {
    if (e instanceof HttpError && e.status === 401) unauthenticated = true;
    // Log the real cause server-side only; the UI gets a fixed, user-safe message.
    console.error('listIssues failed:', e instanceof Error ? e.message : e);
    error = 'Could not load issues';
  }
  if (unauthenticated) redirect('/login'); // expired/invalid session cookie (middleware only checks presence)
  return <Shell key={error ? "error" : sim ?? "ok"} initialIssues={issues} loadError={error} truncated={truncated} initialFilters={parseFilters(sp, meta, true)} meta={meta} api={api} today={today} initialView={parseView(sp.view)} readOnly={readOnly} initialIssueId={Array.isArray(sp.issue) ? sp.issue[0] : sp.issue} />;
}

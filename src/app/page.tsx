import { listIssues, parseSimState } from '@/lib/mock-api';
import { Shell } from '@/components/Shell';
import { parseFilters, TODAY_RE } from '@/lib/filters';
import { seedIssues, type Issue } from '@/lib/issues';

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const sim = parseSimState(sp.state);
  // Perf fixture: never in production, unless the e2e server opts in explicitly (PERF_SEED=1).
  const seedAllowed = process.env.NODE_ENV !== 'production' || process.env.PERF_SEED === '1';
  const seed = !seedAllowed ? 0 : Number(Array.isArray(sp.seed) ? sp.seed[0] : sp.seed) || 0;
  const todayParam = Array.isArray(sp.today) ? sp.today[0] : sp.today;
  const today = todayParam && TODAY_RE.test(todayParam) ? todayParam : new Date().toISOString().slice(0, 10);
  let issues: Issue[] = [];
  let error: string | null = null;
  try { issues = await listIssues(sim);
    if (seed > 0 && !sim) issues = [...issues, ...seedIssues(seed)]; } catch (e) {
    // Log the real cause server-side only; the UI gets a fixed, user-safe message.
    console.error('listIssues failed:', e instanceof Error ? e.message : e);
    error = 'Could not load issues';
  }
  return <Shell key={error ? "error" : sim ?? "ok"} initialIssues={issues} loadError={error} initialFilters={parseFilters(sp)} today={today} />;
}

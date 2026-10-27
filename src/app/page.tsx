import { listIssues, parseSimState } from '@/lib/mock-api';
import { Shell } from '@/components/Shell';
import type { Issue } from '@/lib/issues';

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sim = parseSimState((await searchParams).state);
  let issues: Issue[] = [];
  let error: string | null = null;
  try { issues = await listIssues(sim); } catch (e) {
    // Log the real cause server-side only; the UI gets a fixed, user-safe message.
    console.error('listIssues failed:', e instanceof Error ? e.message : e);
    error = 'Could not load issues';
  }
  return <Shell key={error ? "error" : sim ?? "ok"} initialIssues={issues} loadError={error} />;
}

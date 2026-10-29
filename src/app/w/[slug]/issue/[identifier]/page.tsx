import { notFound, redirect } from 'next/navigation';
import { IssueDetail } from '@/components/IssueDetail';
import { loadRemote, loadViewer, HttpError } from '@/lib/remote';
import { getWorkspaceContext } from '@/lib/auth/workspace-context';
import { findByIdentifier } from '@/lib/detail/issue-meta';
import '../../../../issue-detail.css';
import '../../../../ui-issue-detail.css';

const IDENT_RE = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,9}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export async function generateMetadata({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  return { title: `${IDENT_RE.test(identifier) ? identifier.toUpperCase() : 'Issue'} · Mini-Linear` };
}

export default async function IssuePage({ params, searchParams }: { params: Promise<{ slug: string; identifier: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug, identifier } = await params;
  const sp = await searchParams;
  if (!SLUG_RE.test(slug) || !IDENT_RE.test(identifier)) notFound();
  // API is the only mode. No session -> /login (inside getWorkspaceContext); not a member of this slug -> 404.
  let api: Awaited<ReturnType<typeof getWorkspaceContext>>;
  try { api = await getWorkspaceContext(slug); } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  let loaded: Awaited<ReturnType<typeof loadRemote>>;
  let viewer: Awaited<ReturnType<typeof loadViewer>>;
  try { [loaded, viewer] = await Promise.all([loadRemote(api), loadViewer(api)]); } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect('/login'); // session expired between the two calls
    throw e;
  }
  const { issues, meta } = loaded;
  const issue = findByIdentifier(issues, identifier);
  if (!issue) notFound();
  const testDay = process.env.NODE_ENV !== 'production' || process.env.PERF_SEED === '1' ? (Array.isArray(sp.today) ? sp.today[0] : sp.today) : undefined;
  const today = testDay && /^\d{4}-\d{2}-\d{2}$/.test(testDay) ? testDay : new Date().toISOString().slice(0, 10);
  return <IssueDetail slug={slug} initial={issue} all={issues} meta={meta} api={true} today={today} viewer={viewer} teamId={api.teamId} />;
}

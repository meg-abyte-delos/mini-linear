import { notFound } from 'next/navigation';
import { IssueDetail, type DetailIssue } from '@/components/IssueDetail';
import { listIssues } from '@/lib/mock-api';
import { MOCK_META, type Meta } from '@/lib/issues';
import { apiConfig, loadRemote } from '@/lib/remote';
import { findByIdentifier } from '@/lib/detail/issue-meta';
import '../../../../issue-detail.css';

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
  const api = apiConfig();
  let issues: DetailIssue[];
  let meta: Meta = MOCK_META;
  if (api) {
    if (api.slug !== slug) notFound();
    ({ issues, meta } = await loadRemote(api));
  } else issues = await listIssues();
  const issue = findByIdentifier(issues, identifier);
  if (!issue) notFound();
  const testDay = process.env.NODE_ENV !== 'production' || process.env.PERF_SEED === '1' ? (Array.isArray(sp.today) ? sp.today[0] : sp.today) : undefined;
  const today = testDay && /^\d{4}-\d{2}-\d{2}$/.test(testDay) ? testDay : new Date().toISOString().slice(0, 10);
  return <IssueDetail slug={slug} initial={issue} all={issues} meta={meta} api={!!api} today={today} />;
}

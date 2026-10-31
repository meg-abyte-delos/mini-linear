import { notFound } from 'next/navigation';
import { HomeView } from '@/components/HomeView';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

// Dedicated Inbox URL (Linear: /inbox). Same view as /?view=inbox, scoped to the slug (unknown or non-member slug: 404).
export default async function InboxPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();
  return <HomeView sp={await searchParams} slug={slug} view='inbox' />;
}

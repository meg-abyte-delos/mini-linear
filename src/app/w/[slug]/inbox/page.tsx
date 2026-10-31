import Home from '@/app/page';

// Dedicated Inbox URL (Linear: /inbox). Same view as /?view=inbox.
export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return Home({ searchParams: Promise.resolve({ ...sp, view: 'inbox' }) });
}

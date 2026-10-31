import { HomeView } from '@/components/HomeView';

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <HomeView sp={await searchParams} />;
}

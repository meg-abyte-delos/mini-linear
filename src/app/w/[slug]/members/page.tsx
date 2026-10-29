import { Members } from '@/components/Members';
export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  return <Members slug={(await params).slug} />;
}

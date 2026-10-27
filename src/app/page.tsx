import { listIssues } from '@/lib/mock-api';
import { Shell } from '@/components/Shell';

export default async function Home() {
  return <Shell initialIssues={await listIssues()} />;
}

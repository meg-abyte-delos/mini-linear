import { listIssues } from '@/lib/issues';
import { Shell } from '@/components/Shell';

export default async function Home() {
  return <Shell initialIssues={await listIssues()} />;
}

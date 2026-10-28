import { Settings } from '@/components/Settings';
export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  return <Settings slug={(await params).slug} />;
}

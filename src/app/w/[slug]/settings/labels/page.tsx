import { SettingsLabels } from '@/components/SettingsLabels';
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <SettingsLabels slug={(await params).slug} />;
}

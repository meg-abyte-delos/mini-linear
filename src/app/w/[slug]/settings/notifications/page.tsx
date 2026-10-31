import { SettingsNotifications } from '@/components/SettingsNotifications';
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <SettingsNotifications slug={(await params).slug} />;
}

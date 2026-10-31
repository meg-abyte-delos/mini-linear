import { SettingsAccount } from '@/components/SettingsAccount';
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <SettingsAccount slug={(await params).slug} page='profile' />;
}

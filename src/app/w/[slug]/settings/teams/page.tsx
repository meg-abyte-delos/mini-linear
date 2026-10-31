import { SettingsTeams } from '@/components/SettingsTeams';
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <SettingsTeams slug={(await params).slug} />;
}

import { SettingsTeamPage } from '@/components/SettingsTeamPage';
import '@/app/settings/teams/[teamId]/team-settings.css';
export default async function Page({ params }: { params: Promise<{ slug: string; teamId: string }> }) {
  const { slug, teamId } = await params;
  return <SettingsTeamPage slug={slug} teamId={teamId} />;
}

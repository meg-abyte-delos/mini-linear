import { TeamSettings } from '@/components/TeamSettings';
import { apiConfig } from '@/lib/remote';
import './team-settings.css';

// /settings/teams/<teamId>?w=<workspace slug> (defaults to the configured workspace). Data loads client-side through
// the authenticated API, so access control stays in the handlers (404 for unknown / invisible teams).
export default async function Page({ params, searchParams }: { params: Promise<{ teamId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { teamId } = await params, sp = await searchParams;
  const w = Array.isArray(sp.w) ? sp.w[0] : sp.w;
  const slug = w && /^[a-z0-9-]{1,64}$/.test(w) ? w : apiConfig()?.slug;
  if (!slug) return <main className="ts"><p role="alert">No workspace selected.</p></main>;
  return <TeamSettings slug={slug} teamId={teamId} />;
}

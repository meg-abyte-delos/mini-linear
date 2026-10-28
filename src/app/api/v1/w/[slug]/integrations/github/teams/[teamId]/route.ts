import { getTeamGithubSettings, putTeamGithubSettings } from "@/lib/integrations/github-admin";
type P = { params: Promise<{ slug: string; teamId: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return getTeamGithubSettings(req, p.slug, p.teamId); };
export const PUT = async (req: Request, { params }: P) => { const p = await params; return putTeamGithubSettings(req, p.slug, p.teamId); };

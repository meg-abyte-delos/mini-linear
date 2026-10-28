import { getSettings, patchSettings } from "@/lib/resources/team-settings";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return getSettings(req, p.slug, p.id); };
export const PATCH = async (req: Request, { params }: P) => { const p = await params; return patchSettings(req, p.slug, p.id); };

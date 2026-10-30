import { getEstimateScale } from "@/lib/resources/team-settings";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return getEstimateScale(req, p.slug, p.id); };

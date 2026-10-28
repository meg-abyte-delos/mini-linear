import { getMilestoneH, patchMilestone, deleteMilestone } from "@/lib/resources/projects-ext";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return getMilestoneH(req, p.slug, p.id); };
export const PATCH = async (req: Request, { params }: P) => { const p = await params; return patchMilestone(req, p.slug, p.id); };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return deleteMilestone(req, p.slug, p.id); };

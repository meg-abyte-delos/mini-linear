import { listMilestones, createMilestone } from "@/lib/resources/projects-ext";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return listMilestones(req, p.slug, p.id); };
export const POST = async (req: Request, { params }: P) => { const p = await params; return createMilestone(req, p.slug, p.id); };

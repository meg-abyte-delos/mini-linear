import { patchTeam, deleteTeam } from "@/lib/resources/tenancy";
type P = { params: Promise<{ slug: string; id: string }> };
export const PATCH = async (req: Request, { params }: P) => { const p = await params; return patchTeam(req, p.slug, p.id); };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return deleteTeam(req, p.slug, p.id); };

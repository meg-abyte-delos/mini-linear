import { addTeamMember, removeTeamMember } from "@/lib/resources/tenancy";
type P = { params: Promise<{ slug: string; id: string; userId: string }> };
export const POST = async (req: Request, { params }: P) => { const p = await params; return addTeamMember(req, p.slug, p.id, p.userId); };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return removeTeamMember(req, p.slug, p.id, p.userId); };

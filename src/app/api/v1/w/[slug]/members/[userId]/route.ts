import { patchMember, deleteMember } from "@/lib/resources/tenancy";
type P = { params: Promise<{ slug: string; userId: string }> };
export const PATCH = async (req: Request, { params }: P) => { const p = await params; return patchMember(req, p.slug, p.userId); };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return deleteMember(req, p.slug, p.userId); };

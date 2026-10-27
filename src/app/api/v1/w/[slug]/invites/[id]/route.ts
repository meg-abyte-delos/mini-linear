import { deleteInvite } from "@/lib/resources/tenancy";
export const DELETE = async (req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) => { const p = await params; return deleteInvite(req, p.slug, p.id); };

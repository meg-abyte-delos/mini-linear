import { resendInvite } from "@/lib/resources/tenancy";
export const POST = async (req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) => { const p = await params; return resendInvite(req, p.slug, p.id); };

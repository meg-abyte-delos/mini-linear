import { unshareIssue } from "@/lib/resources/shares-audit";
export const DELETE = async (req: Request, { params }: { params: Promise<{ slug: string; id: string; guestId: string }> }) => { const p = await params; return unshareIssue(req, p.slug, p.id, p.guestId); };

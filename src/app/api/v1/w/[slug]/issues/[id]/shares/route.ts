import { shareIssue, listShares } from "@/lib/resources/shares-audit";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return listShares(req, p.slug, p.id); };
export const POST = async (req: Request, { params }: P) => { const p = await params; return shareIssue(req, p.slug, p.id); };

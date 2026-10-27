import { restoreIssue } from "@/lib/issues/handlers";
export const POST = async (req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) => { const p = await params; return restoreIssue(req, p.slug, p.id); };

import { archiveIssue } from "@/lib/issues/handlers";
export const POST = async (req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) => { const p = await params; return archiveIssue(req, p.slug, p.id); };

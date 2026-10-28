import { bulkIssues } from "@/lib/issues/handlers";
export const POST = async (req: Request, { params }: { params: Promise<{ slug: string }> }) => { const p = await params; return bulkIssues(req, p.slug); };

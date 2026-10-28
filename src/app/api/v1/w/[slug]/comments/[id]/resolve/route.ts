import { resolveComment } from "@/lib/resources/projects-comments";
type P = { params: Promise<{ slug: string; id: string }> };
export const POST = async (req: Request, { params }: P) => { const x = await params; return resolveComment(req, x.slug, x.id); };

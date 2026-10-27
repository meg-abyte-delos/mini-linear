import { createComment, listComments } from "@/lib/resources/projects-comments";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const x = await params; return listComments(req, x.slug, x.id); };
export const POST = async (req: Request, { params }: P) => { const x = await params; return createComment(req, x.slug, x.id); };

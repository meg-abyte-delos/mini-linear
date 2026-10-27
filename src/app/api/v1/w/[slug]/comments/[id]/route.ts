import { getCommentH, patchComment, deleteComment } from "@/lib/resources/projects-comments";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const x = await params; return getCommentH(req, x.slug, x.id); };
export const PATCH = async (req: Request, { params }: P) => { const x = await params; return patchComment(req, x.slug, x.id); };
export const DELETE = async (req: Request, { params }: P) => { const x = await params; return deleteComment(req, x.slug, x.id); };

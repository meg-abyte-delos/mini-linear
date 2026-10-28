import { listReactions, addReaction, removeReaction } from "@/lib/resources/projects-comments";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const x = await params; return listReactions(req, x.slug, x.id); };
export const POST = async (req: Request, { params }: P) => { const x = await params; return addReaction(req, x.slug, x.id); };
export const DELETE = async (req: Request, { params }: P) => { const x = await params; return removeReaction(req, x.slug, x.id); };

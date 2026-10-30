import { deleteRecent } from "@/lib/search/recents";
type P = { params: Promise<{ slug: string; id: string }> };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return deleteRecent(req, p.slug, p.id); };

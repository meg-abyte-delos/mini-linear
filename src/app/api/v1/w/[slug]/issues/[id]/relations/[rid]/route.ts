import { deleteRelation } from "@/lib/issues/relations";
type P = { params: Promise<{ slug: string; id: string; rid: string }> };
export const DELETE = async (req: Request, { params }: P) => { const x = await params; return deleteRelation(req, x.slug, x.id, x.rid); };

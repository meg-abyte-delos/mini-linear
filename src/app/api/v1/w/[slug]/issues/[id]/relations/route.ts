import { createRelation, listRelations } from "@/lib/issues/relations";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const x = await params; return listRelations(req, x.slug, x.id); };
export const POST = async (req: Request, { params }: P) => { const x = await params; return createRelation(req, x.slug, x.id); };

import { listChildren } from "@/lib/issues/relations";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const x = await params; return listChildren(req, x.slug, x.id); };

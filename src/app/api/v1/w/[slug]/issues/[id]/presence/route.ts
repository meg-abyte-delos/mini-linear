import { presence } from "@/lib/sync/server/feed";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string; id: string }> };
const h = async (req: Request, { params }: P) => { const p = await params; return presence(req, p.slug, p.id); };
export const GET = h, POST = h, DELETE = h;

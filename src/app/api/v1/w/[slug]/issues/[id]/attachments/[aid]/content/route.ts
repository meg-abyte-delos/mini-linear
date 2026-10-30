import { getContent, putContent } from "@/lib/attachments/uploads";
type P = { params: Promise<{ slug: string; id: string; aid: string }> };
export const runtime = "nodejs";
export const GET = async (req: Request, { params }: P) => { const p = await params; return getContent(req, p.slug, p.id, p.aid); };
export const PUT = async (req: Request, { params }: P) => { const p = await params; return putContent(req, p.slug, p.id, p.aid); };

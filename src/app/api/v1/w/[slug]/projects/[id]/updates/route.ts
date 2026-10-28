import { listUpdates, createUpdate } from "@/lib/resources/projects-ext";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return listUpdates(req, p.slug, p.id); };
export const POST = async (req: Request, { params }: P) => { const p = await params; return createUpdate(req, p.slug, p.id); };

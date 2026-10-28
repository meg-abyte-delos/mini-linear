import { listTemplates, createTemplate } from "@/lib/resources/templates";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return listTemplates(req, p.slug, p.id); };
export const POST = async (req: Request, { params }: P) => { const p = await params; return createTemplate(req, p.slug, p.id); };

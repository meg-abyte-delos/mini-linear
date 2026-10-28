import { getTemplate, patchTemplate, deleteTemplate } from "@/lib/resources/templates";
type P = { params: Promise<{ slug: string; id: string; tid: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return getTemplate(req, p.slug, p.id, p.tid); };
export const PATCH = async (req: Request, { params }: P) => { const p = await params; return patchTemplate(req, p.slug, p.id, p.tid); };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return deleteTemplate(req, p.slug, p.id, p.tid); };

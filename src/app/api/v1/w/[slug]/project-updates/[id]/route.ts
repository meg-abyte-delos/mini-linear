import { patchUpdate, deleteUpdate } from "@/lib/resources/projects-ext";
type P = { params: Promise<{ slug: string; id: string }> };
export const PATCH = async (req: Request, { params }: P) => { const p = await params; return patchUpdate(req, p.slug, p.id); };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return deleteUpdate(req, p.slug, p.id); };

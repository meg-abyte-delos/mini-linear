import { deleteIssue, getIssue, patchIssue } from "@/lib/issues/handlers";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return getIssue(req, p.slug, p.id); };
export const PATCH = async (req: Request, { params }: P) => { const p = await params; return patchIssue(req, p.slug, p.id); };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return deleteIssue(req, p.slug, p.id); };

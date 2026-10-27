import { getProjectH, patchProject, deleteProject } from "@/lib/resources/projects-comments";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const x = await params; return getProjectH(req, x.slug, x.id); };
export const PATCH = async (req: Request, { params }: P) => { const x = await params; return patchProject(req, x.slug, x.id); };
export const DELETE = async (req: Request, { params }: P) => { const x = await params; return deleteProject(req, x.slug, x.id); };

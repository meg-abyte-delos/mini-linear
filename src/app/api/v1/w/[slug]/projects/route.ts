import { listProjects, createProject } from "@/lib/resources/projects-comments";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listProjects(req, (await params).slug);
export const POST = async (req: Request, { params }: P) => createProject(req, (await params).slug);

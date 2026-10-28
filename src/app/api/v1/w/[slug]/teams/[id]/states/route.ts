import { listStates, createState } from "@/lib/resources/workflow-states";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return listStates(req, p.slug, p.id); };
export const POST = async (req: Request, { params }: P) => { const p = await params; return createState(req, p.slug, p.id); };

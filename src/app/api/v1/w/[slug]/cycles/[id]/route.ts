import { getCycleH, patchCycle, deleteCycle } from "@/lib/resources/labels-cycles";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const x = await params; return getCycleH(req, x.slug, x.id); };
export const PATCH = async (req: Request, { params }: P) => { const x = await params; return patchCycle(req, x.slug, x.id); };
export const DELETE = async (req: Request, { params }: P) => { const x = await params; return deleteCycle(req, x.slug, x.id); };

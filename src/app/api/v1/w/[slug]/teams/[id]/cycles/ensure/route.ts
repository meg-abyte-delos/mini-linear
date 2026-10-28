import { ensureCycles } from "@/lib/resources/cycles-schedule";
type P = { params: Promise<{ slug: string; id: string }> };
export const POST = async (req: Request, { params }: P) => { const x = await params; return ensureCycles(req, x.slug, x.id); };

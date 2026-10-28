import { completeCycle } from "@/lib/resources/cycles-schedule";
type P = { params: Promise<{ slug: string; id: string }> };
export const POST = async (req: Request, { params }: P) => { const x = await params; return completeCycle(req, x.slug, x.id); };

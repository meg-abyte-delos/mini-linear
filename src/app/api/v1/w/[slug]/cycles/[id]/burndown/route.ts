import { cycleBurndown } from "@/lib/resources/cycles-schedule";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const x = await params; return cycleBurndown(req, x.slug, x.id); };

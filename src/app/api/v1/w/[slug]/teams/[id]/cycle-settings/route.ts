import { getCycleSettings, putCycleSettings } from "@/lib/resources/cycles-schedule";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const x = await params; return getCycleSettings(req, x.slug, x.id); };
export const PUT = async (req: Request, { params }: P) => { const x = await params; return putCycleSettings(req, x.slug, x.id); };

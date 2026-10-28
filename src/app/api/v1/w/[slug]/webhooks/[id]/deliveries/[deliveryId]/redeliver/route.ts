import { redeliver } from "@/lib/resources/integrations";
type P = { params: Promise<{ slug: string; id: string; deliveryId: string }> };
export const POST = async (req: Request, { params }: P) => { const p = await params; return redeliver(req, p.slug, p.id, p.deliveryId); };

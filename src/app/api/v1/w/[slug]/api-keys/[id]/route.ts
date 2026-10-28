import { revokeApiKey } from "@/lib/resources/integrations";
type P = { params: Promise<{ slug: string; id: string }> };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return revokeApiKey(req, p.slug, p.id); };

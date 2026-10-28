import { deleteWebhook, getWebhookH, patchWebhook } from "@/lib/resources/integrations";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return getWebhookH(req, p.slug, p.id); };
export const PATCH = async (req: Request, { params }: P) => { const p = await params; return patchWebhook(req, p.slug, p.id); };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return deleteWebhook(req, p.slug, p.id); };

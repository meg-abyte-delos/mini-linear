import { createWebhook, listWebhooks } from "@/lib/resources/integrations";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listWebhooks(req, (await params).slug);
export const POST = async (req: Request, { params }: P) => createWebhook(req, (await params).slug);

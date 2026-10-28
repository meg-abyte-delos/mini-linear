import { createApiKey, listApiKeys } from "@/lib/resources/integrations";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listApiKeys(req, (await params).slug);
export const POST = async (req: Request, { params }: P) => createApiKey(req, (await params).slug);

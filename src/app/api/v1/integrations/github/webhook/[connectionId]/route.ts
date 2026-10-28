import { handleGithubWebhook } from "@/lib/integrations/github";
type P = { params: Promise<{ connectionId: string }> };
export const POST = async (req: Request, { params }: P) => handleGithubWebhook(req, (await params).connectionId);

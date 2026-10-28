import { listIssuePrLinks } from "@/lib/integrations/github-admin";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listIssuePrLinks(req, (await params).slug);

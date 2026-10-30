import { presenceBody } from "@/lib/sync/server/feed";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string }> };
const h = async (req: Request, { params }: P) => presenceBody(req, (await params).slug);
export const POST = h, DELETE = h;

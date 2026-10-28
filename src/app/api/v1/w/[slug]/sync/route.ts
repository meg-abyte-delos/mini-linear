import { getFeed } from "@/lib/sync/server/feed";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => getFeed(req, (await params).slug);

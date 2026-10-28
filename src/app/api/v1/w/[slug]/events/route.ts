import { eventsRoute } from "@/lib/sync/server/sse";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => eventsRoute(req, (await params).slug);

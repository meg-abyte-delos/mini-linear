import { addRecent, clearRecents, listRecents } from "@/lib/search/recents";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listRecents(req, (await params).slug);
export const POST = async (req: Request, { params }: P) => addRecent(req, (await params).slug);
export const DELETE = async (req: Request, { params }: P) => clearRecents(req, (await params).slug);

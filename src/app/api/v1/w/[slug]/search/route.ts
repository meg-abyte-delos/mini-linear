import { searchWorkspace } from "@/lib/search/handlers";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => searchWorkspace(req, (await params).slug);

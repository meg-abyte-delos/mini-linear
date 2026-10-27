import { listCycles, createCycle } from "@/lib/resources/labels-cycles";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listCycles(req, (await params).slug);
export const POST = async (req: Request, { params }: P) => createCycle(req, (await params).slug);

import { listLabels, createLabel } from "@/lib/resources/labels-cycles";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listLabels(req, (await params).slug);
export const POST = async (req: Request, { params }: P) => createLabel(req, (await params).slug);

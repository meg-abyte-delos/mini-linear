import { getLabelH, patchLabel, deleteLabel } from "@/lib/resources/labels-cycles";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const x = await params; return getLabelH(req, x.slug, x.id); };
export const PATCH = async (req: Request, { params }: P) => { const x = await params; return patchLabel(req, x.slug, x.id); };
export const DELETE = async (req: Request, { params }: P) => { const x = await params; return deleteLabel(req, x.slug, x.id); };

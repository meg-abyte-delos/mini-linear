import { getViewH, patchView, deleteView } from '@/lib/resources/views';
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return getViewH(req, p.slug, p.id); };
export const PATCH = async (req: Request, { params }: P) => { const p = await params; return patchView(req, p.slug, p.id); };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return deleteView(req, p.slug, p.id); };

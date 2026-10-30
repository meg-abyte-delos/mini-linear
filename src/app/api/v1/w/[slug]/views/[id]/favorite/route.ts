import { putFavorite, deleteFavorite } from '@/lib/resources/view-state';
type P = { params: Promise<{ slug: string; id: string }> };
export const PUT = async (req: Request, { params }: P) => { const p = await params; return putFavorite(req, p.slug, p.id); };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return deleteFavorite(req, p.slug, p.id); };

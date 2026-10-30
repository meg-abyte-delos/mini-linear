import { listFavorites } from '@/lib/resources/view-state';
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listFavorites(req, (await params).slug);

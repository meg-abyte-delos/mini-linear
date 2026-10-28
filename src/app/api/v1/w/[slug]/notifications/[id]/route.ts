import { getNotification, deleteNotification } from '@/lib/resources/notifications';
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const x = await params; return getNotification(req, x.slug, x.id); };
export const DELETE = async (req: Request, { params }: P) => { const x = await params; return deleteNotification(req, x.slug, x.id); };

import { notificationAction } from '@/lib/resources/notifications';
type P = { params: Promise<{ slug: string; id: string }> };
export const POST = async (req: Request, { params }: P) => { const x = await params; return notificationAction(req, x.slug, x.id, 'read'); };

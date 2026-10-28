import { getUnreadCount } from '@/lib/resources/notifications';
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => getUnreadCount(req, (await params).slug);

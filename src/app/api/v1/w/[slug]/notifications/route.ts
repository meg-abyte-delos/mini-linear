import { listNotifications } from '@/lib/resources/notifications';
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listNotifications(req, (await params).slug);

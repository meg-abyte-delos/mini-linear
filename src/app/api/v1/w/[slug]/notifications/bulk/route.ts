import { bulkNotifications } from '@/lib/resources/notifications';
type P = { params: Promise<{ slug: string }> };
export const POST = async (req: Request, { params }: P) => bulkNotifications(req, (await params).slug);

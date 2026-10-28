import { archiveRead } from '@/lib/resources/notifications';
type P = { params: Promise<{ slug: string }> };
export const POST = async (req: Request, { params }: P) => archiveRead(req, (await params).slug);

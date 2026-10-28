import { readAll } from '@/lib/resources/notifications';
type P = { params: Promise<{ slug: string }> };
export const POST = async (req: Request, { params }: P) => readAll(req, (await params).slug);

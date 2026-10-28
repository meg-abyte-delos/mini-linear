import { getPreferences, putPreferences } from '@/lib/resources/notifications';
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => getPreferences(req, (await params).slug);
export const PUT = async (req: Request, { params }: P) => putPreferences(req, (await params).slug);

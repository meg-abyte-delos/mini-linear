import { listViews, createView } from '@/lib/resources/views';
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listViews(req, (await params).slug);
export const POST = async (req: Request, { params }: P) => createView(req, (await params).slug);

import { getViewState, putViewState, deleteViewState } from '@/lib/resources/view-state';
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => getViewState(req, (await params).slug);
export const PUT = async (req: Request, { params }: P) => putViewState(req, (await params).slug);
export const DELETE = async (req: Request, { params }: P) => deleteViewState(req, (await params).slug);

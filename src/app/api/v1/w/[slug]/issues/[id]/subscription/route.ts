import { getSubscription, putSubscription, deleteSubscription } from "@/lib/resources/subscriptions";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const x = await params; return getSubscription(req, x.slug, x.id); };
export const PUT = async (req: Request, { params }: P) => { const x = await params; return putSubscription(req, x.slug, x.id); };
export const DELETE = async (req: Request, { params }: P) => { const x = await params; return deleteSubscription(req, x.slug, x.id); };

import { entitySubscription } from '@/lib/resources/entity-subscriptions';
type P = { params: Promise<{ slug: string; kind: string; entityId: string }> };
const h = async (req: Request, { params }: P) => { const p = await params; return entitySubscription(req, p.slug, p.kind, p.entityId); };
export const PUT = h;
export const DELETE = h;

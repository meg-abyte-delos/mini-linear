import { listEntitySubscriptions } from '@/lib/resources/entity-subscriptions';
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listEntitySubscriptions(req, (await params).slug);

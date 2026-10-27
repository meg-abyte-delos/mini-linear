import { listInvites, createInvite } from "@/lib/resources/tenancy";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listInvites(req, (await params).slug);
export const POST = async (req: Request, { params }: P) => createInvite(req, (await params).slug);

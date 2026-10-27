import { listMembers } from "@/lib/resources/tenancy";
// No POST: members join only through invites (assumption, see PR notes).
export const GET = async (req: Request, { params }: { params: Promise<{ slug: string }> }) => listMembers(req, (await params).slug);

import { listTeamMembers } from "@/lib/resources/tenancy";
export const GET = async (req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) => { const p = await params; return listTeamMembers(req, p.slug, p.id); };

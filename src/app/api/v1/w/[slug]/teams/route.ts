import { listTeams, createTeam } from "@/lib/resources/tenancy";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listTeams(req, (await params).slug);
export const POST = async (req: Request, { params }: P) => createTeam(req, (await params).slug);

import { listGroups, createGroup } from "@/lib/resources/team-settings";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listGroups(req, (await params).slug);
export const POST = async (req: Request, { params }: P) => createGroup(req, (await params).slug);

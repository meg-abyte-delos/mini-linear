import { getWorkspace } from "@/lib/resources/tenancy";
export const GET = async (req: Request, { params }: { params: Promise<{ slug: string }> }) => getWorkspace(req, (await params).slug);

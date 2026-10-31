import { getWorkspace, deleteWorkspace } from "@/lib/resources/tenancy";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => getWorkspace(req, (await params).slug);
export const DELETE = async (req: Request, { params }: P) => deleteWorkspace(req, (await params).slug);

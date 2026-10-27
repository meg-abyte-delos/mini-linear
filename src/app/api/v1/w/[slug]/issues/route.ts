import { createIssue, listIssues } from "@/lib/issues/handlers";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => listIssues(req, (await params).slug);
export const POST = async (req: Request, { params }: P) => createIssue(req, (await params).slug);

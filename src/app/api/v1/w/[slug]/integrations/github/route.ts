import { getGithubConnection, putGithubConnection, deleteGithubConnection } from "@/lib/integrations/github-admin";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => getGithubConnection(req, (await params).slug);
export const PUT = async (req: Request, { params }: P) => putGithubConnection(req, (await params).slug);
export const DELETE = async (req: Request, { params }: P) => deleteGithubConnection(req, (await params).slug);

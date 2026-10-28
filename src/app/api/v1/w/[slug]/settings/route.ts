import { getWorkspaceSettings, patchWorkspaceSettings } from "@/lib/resources/tenancy";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => getWorkspaceSettings(req, (await params).slug);
export const PATCH = async (req: Request, { params }: P) => patchWorkspaceSettings(req, (await params).slug);

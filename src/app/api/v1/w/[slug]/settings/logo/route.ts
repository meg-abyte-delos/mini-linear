import { getLogo, uploadLogo } from "@/lib/resources/workspace-logo";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => getLogo(req, (await params).slug);
export const POST = async (req: Request, { params }: P) => uploadLogo(req, (await params).slug);

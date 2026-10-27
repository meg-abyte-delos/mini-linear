import { listAudit } from "@/lib/resources/shares-audit";
export const GET = async (req: Request, { params }: { params: Promise<{ slug: string }> }) => listAudit(req, (await params).slug);

import { createAttachment, listAttachments } from "@/lib/issues/activity-attachments";
type P = { params: Promise<{ slug: string; id: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return listAttachments(req, p.slug, p.id); };
export const POST = async (req: Request, { params }: P) => { const p = await params; return createAttachment(req, p.slug, p.id); };

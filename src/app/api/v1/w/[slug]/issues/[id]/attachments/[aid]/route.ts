import { deleteAttachment } from "@/lib/issues/activity-attachments";
export const DELETE = async (req: Request, { params }: { params: Promise<{ slug: string; id: string; aid: string }> }) => { const p = await params; return deleteAttachment(req, p.slug, p.id, p.aid); };

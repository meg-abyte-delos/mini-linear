import { listActivity } from "@/lib/issues/activity-attachments";
export const GET = async (req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) => { const p = await params; return listActivity(req, p.slug, p.id); };

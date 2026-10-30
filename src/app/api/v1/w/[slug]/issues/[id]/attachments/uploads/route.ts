import { createUpload } from "@/lib/attachments/uploads";
export const POST = async (req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) => { const p = await params; return createUpload(req, p.slug, p.id); };

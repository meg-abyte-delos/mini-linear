import { snapshotCycles } from "@/lib/resources/cycles-schedule";
type P = { params: Promise<{ slug: string }> };
export const POST = async (req: Request, { params }: P) => snapshotCycles(req, (await params).slug);

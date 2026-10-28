import { cycleWindow } from "@/lib/resources/cycles-schedule";
type P = { params: Promise<{ slug: string }> };
export const GET = async (req: Request, { params }: P) => cycleWindow(req, (await params).slug);

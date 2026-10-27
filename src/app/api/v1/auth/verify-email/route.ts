import { verifyEmail } from "@/lib/auth/service";
export const POST = (req: Request) => verifyEmail(req);

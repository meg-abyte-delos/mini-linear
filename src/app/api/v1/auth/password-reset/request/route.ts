import { passwordResetRequest } from "@/lib/auth/service";
export const POST = (req: Request) => passwordResetRequest(req);

import { passwordResetConfirm } from "@/lib/auth/service";
export const POST = (req: Request) => passwordResetConfirm(req);

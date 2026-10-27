import { logoutAll } from "@/lib/auth/service";
export const POST = (req: Request) => logoutAll(req);

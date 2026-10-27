import { logout } from "@/lib/auth/service";
export const POST = (req: Request) => logout(req);

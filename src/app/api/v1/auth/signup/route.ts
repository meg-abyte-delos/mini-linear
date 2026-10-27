import { signup } from "@/lib/auth/service";
export const POST = (req: Request) => signup(req);

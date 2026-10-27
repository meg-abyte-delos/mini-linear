import { login } from "@/lib/auth/service";
export const POST = (req: Request) => login(req);

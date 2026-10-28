import { me, patchMe } from "@/lib/auth/service";
export const GET = (req: Request) => me(req);
export const PATCH = (req: Request) => patchMe(req);

import { me } from "@/lib/auth/service";
export const GET = (req: Request) => me(req);

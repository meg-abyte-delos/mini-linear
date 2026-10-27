import { acceptInvite } from "@/lib/resources/tenancy";
export const POST = (req: Request) => acceptInvite(req);

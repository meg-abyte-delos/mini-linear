import { listWorkspaces, createWorkspace } from "@/lib/resources/tenancy";
export const GET = (req: Request) => listWorkspaces(req);
export const POST = (req: Request) => createWorkspace(req);

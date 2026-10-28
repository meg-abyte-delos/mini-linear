import { getStateH, patchState, deleteState } from "@/lib/resources/workflow-states";
type P = { params: Promise<{ slug: string; id: string; stateId: string }> };
export const GET = async (req: Request, { params }: P) => { const p = await params; return getStateH(req, p.slug, p.id, p.stateId); };
export const PATCH = async (req: Request, { params }: P) => { const p = await params; return patchState(req, p.slug, p.id, p.stateId); };
export const DELETE = async (req: Request, { params }: P) => { const p = await params; return deleteState(req, p.slug, p.id, p.stateId); };

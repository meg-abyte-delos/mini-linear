import { z } from "zod";
import { ApiError } from "./errors";

export const uuidSchema = z.string().uuid();
export const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(512).optional() });

export async function parseJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new ApiError("bad_request", "body must be JSON"); }
  return schema.parse(raw);
}
export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}
export function parseId(v: string): string {
  const r = uuidSchema.safeParse(v);
  if (!r.success) throw new ApiError("not_found"); // malformed id behaves like an unknown one
  return r.data;
}

/** Optimistic concurrency: If-Match carries the row version (3 or W/"3"). Missing -> 428, malformed -> 400. */
export function ifMatchVersion(req: Request): number {
  const h = req.headers.get("if-match");
  if (h === null) throw new ApiError("precondition_required", "If-Match required");
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(h.trim());
  if (!m) throw new ApiError("bad_request", "invalid If-Match");
  return Number(m[1]);
}

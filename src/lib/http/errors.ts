import { ZodError } from "zod";

export type ErrorCode = "bad_request" | "unauthenticated" | "forbidden" | "not_found" | "conflict" | "precondition_failed" | "precondition_required" | "validation_failed" | "rate_limited" | "internal";
const STATUS: Record<ErrorCode, number> = { bad_request: 400, unauthenticated: 401, forbidden: 403, not_found: 404, conflict: 409, precondition_failed: 412, precondition_required: 428, validation_failed: 422, rate_limited: 429, internal: 500 };

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string = code, public details?: unknown) { super(message); }
  get status() { return STATUS[this.code]; }
}

const pgCode = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "");

/** Map any thrown value to a JSON error response { error: { code, message, details? } }. Unknown errors never leak internals. */
export function errorResponse(e: unknown): Response {
  let err: ApiError;
  if (e instanceof ApiError) err = e;
  else if (e instanceof ZodError) err = new ApiError("validation_failed", "invalid request", e.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  else if (pgCode(e) === "23514") err = new ApiError("validation_failed", "constraint violated");
  else if (pgCode(e) === "23505") err = new ApiError("conflict", "already exists");
  else if (pgCode(e) === "23503") err = new ApiError("validation_failed", "referenced entity not found");
  else err = new ApiError("internal", "internal error");
  return Response.json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, { status: err.status });
}

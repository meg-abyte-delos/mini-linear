import { createHash, randomBytes } from "node:crypto";

/** Opaque random token (256 bit). Only its sha256 is stored. */
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

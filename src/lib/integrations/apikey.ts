import { randomBytes } from "node:crypto";
import { hashToken } from "../auth/tokens";

/**
 * Personal API keys: `mlk_<prefix>_<secret>`. prefix = 8 [a-z0-9] chars, shown in the UI to recognise a key;
 * secret = 256-bit base64url. Only sha256(full token) is stored (api_keys.key_hash).
 */
export const KEY_RE = /^mlk_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;
const ALPHA = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newApiKey(): { token: string; prefix: string; hash: string } {
  const b = randomBytes(8);
  const prefix = Array.from(b, (x) => ALPHA[x % ALPHA.length]).join("");
  const token = `mlk_${prefix}_${randomBytes(32).toString("base64url")}`;
  return { token, prefix, hash: hashToken(token) };
}

/** Bearer token from Authorization if it looks like an API key; undefined = no API key presented; null = malformed. */
export function bearerApiKey(req: Request): string | null | undefined {
  const h = req.headers.get("authorization");
  if (h === null) return undefined;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  if (!m) return null;
  return KEY_RE.test(m[1]!) ? m[1]! : null;
}

export const API_RATE_LIMIT = { limit: Number(process.env.API_KEY_RATE_LIMIT ?? 600), windowSec: 60 };
export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

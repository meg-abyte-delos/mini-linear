import { hash, verify } from "@node-rs/argon2";

// argon2id, OWASP minimum profile (19 MiB, t=2, p=1). Algorithm.Argon2id === 2 (const enum, so the literal is used).
const OPTS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, OPTS);

// Verified when the account does not exist so that unknown-email and wrong-password logins cost the same (timing, App. A).
let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hash("dummy-password-for-timing", OPTS));

export async function verifyPassword(stored: string | null, pw: string): Promise<boolean> {
  const h = stored ?? (await dummyHash());
  try { return (await verify(h, pw)) && stored !== null; } catch { return false; }
}

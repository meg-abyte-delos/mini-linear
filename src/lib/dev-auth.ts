// Dev-only session stub until M1 lands. ML_DEV_AUTH=1 + ML_DEV_USER_ID=<user uuid> signs every request in as that user.
// Refused (throws) when NODE_ENV=production. M1 replaces it with the real resolver via setSessionResolver.
import { setSessionResolver } from '@/lib/http/ctx';

let installed = false;
export function installDevAuth(): void {
  if (process.env.ML_DEV_AUTH !== '1') return;
  if (process.env.NODE_ENV === 'production') throw new Error('ML_DEV_AUTH=1 is refused when NODE_ENV=production');
  if (installed) return;
  const uid = process.env.ML_DEV_USER_ID;
  if (!uid) throw new Error('ML_DEV_AUTH=1 needs ML_DEV_USER_ID');
  setSessionResolver(async () => uid);
  installed = true;
}

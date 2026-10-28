// Test-only isolation: next start has no socket resolver, so every request lands in the shared 'unknown'
// rate-limit bucket (ML_ALLOW_SHARED_RATELIMIT_BUCKET=1). Reset the windows around each test so suites
// do not 429 each other; tests that assert rate limiting do all their hits inside one test.
import { beforeAll, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
const url = process.env.DATABASE_OWNER_URL;
const pool = url ? new pg.Pool({ connectionString: url, max: 1 }) : null;
const reset = async () => { if (pool) await pool.query('delete from rate_limits'); };
beforeAll(reset);
beforeEach(reset);
afterAll(async () => { await pool?.end(); });

import { defineConfig } from "drizzle-kit";
// Migrations run as the OWNER role (DATABASE_OWNER_URL). The app connects as app_user (DATABASE_URL). See Spec v1.1 + Appendix A S12.
export default defineConfig({ dialect: "postgresql", schema: "./src/db/schema.ts", out: "./db/migrations", dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? "" } });

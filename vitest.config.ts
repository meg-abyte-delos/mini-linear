import { defineConfig } from "vitest/config";
// Integration suites need a running app + seeded Postgres (M1). They run only when INTEGRATION=1.
const integration = process.env.INTEGRATION === "1";
export default defineConfig({
  test: {
    include: integration ? ["tests/integration/**/*.test.ts"] : ["tests/unit/**/*.test.ts"],
    // Gate loads only for the integration run: missing env throws (fail, not skip).
    setupFiles: integration ? ["tests/integration/helpers/gate.ts"] : [],
    coverage: { provider: "v8" },
  },
});

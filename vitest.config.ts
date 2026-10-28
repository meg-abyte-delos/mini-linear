import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/security/**/*.test.ts"], coverage: { provider: "v8", include: ["src/**/*.ts"], reporter: ["text-summary", "json-summary", "html"] },
    // Integration suites share one DB and fixture slugs (w1/w2): run files one at a time.
    fileParallelism: false,
    setupFiles: ["tests/setup-ratelimit.ts"] },
});

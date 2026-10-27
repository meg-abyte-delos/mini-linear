import js from "@eslint/js";
import tseslint from "typescript-eslint";
import next from "@next/eslint-plugin-next";

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts", "*.tsbuildinfo"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "@next/next": next },
    rules: { ...next.configs.recommended.rules, ...next.configs["core-web-vitals"].rules },
  },
);

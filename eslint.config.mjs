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
  {
    // TDZ guard (see #120): a render-time call to a closure that reads a later `const` crashes the page.
    files: ["src/components/Shell.tsx"],
    rules: {
      "no-use-before-define": "off",
      "@typescript-eslint/no-use-before-define": ["error", { functions: false, classes: true, variables: true, typedefs: false, ignoreTypeReferences: true }],
    },
  },
);

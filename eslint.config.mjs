import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // A separate Node service with its own package.json; not part of the Next.js app.
    "whatsapp-gateway/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
    },
  },
  // functions/ is the Cloud Functions package: its own package.json, no "type" field, so
  // CommonJS, deployed as-is with no build step. `require()` is the only correct import there, and
  // this rule flagged every single one — 55 errors, all of them this rule, which is why the lint
  // baseline sat in the 70s and a genuine new error anywhere in the app could hide under it.
  {
    files: ["functions/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;

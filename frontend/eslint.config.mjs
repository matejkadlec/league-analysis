import { fixupConfigRules } from "@eslint/compat";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  ...fixupConfigRules([...nextCoreWebVitals, ...nextTypeScript]),
  // Type-aware layer. `eslint-config-next/typescript` already registers the
  // `@typescript-eslint` plugin and parser, so this block only turns on the
  // type information the parser needs plus the rules that consume it.
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  // Console statements are this app's developer-observability channel, and
  // each remaining surface is reviewed: API validation mismatches, Data
  // Dragon fallbacks, the API error reporter, and dev-gated auth warns.
  // Everything else must go through the toast adapter in `lib/core/hooks`.
  {
    files: ["**/*.{js,cjs,mjs,cts,mts,ts,tsx}"],
    rules: {
      "no-console": "error",
    },
  },
  {
    files: [
      "features/auth/context/auth-context.tsx",
      "lib/core/api-error-logging.ts",
      "lib/core/api.ts",
      "lib/core/data-dragon-version.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["tests/**"],
    rules: {
      "no-console": "off",
    },
  },
];

export default eslintConfig;

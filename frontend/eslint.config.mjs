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
];

export default eslintConfig;

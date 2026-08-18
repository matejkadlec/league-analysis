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
  // Only the refresh call may give up on a session.
  //
  // `refreshAccessToken` is the one place that can tell a rejected session
  // (401/403) from a server it could not reach (502, timeout, offline).
  // Everywhere else sees the same failed request either way, so a teardown
  // from anywhere else signs people out over a redeploy or a dropped
  // connection, with a valid refresh cookie still in the jar and the hint
  // gone that would have let it be used.
  //
  // This lived in a test that scanned source text with regexes, and was
  // defeated twice: by an aliased import, by a cookie string held in a
  // variable, by bracket notation, by a `//` inside a string literal eating
  // the line. Every one of those is a spelling, and a spelling always has
  // another spelling. These rules read the syntax tree and the module graph
  // instead, so renaming on import or reaching the property a different way
  // changes nothing.
  {
    files: ["**/*.{js,cjs,mjs,cts,mts,ts,tsx}"],
    ignores: ["tests/**", "e2e/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/features/auth/utils/token-manager",
              importNames: ["removeAuthTokens"],
              message:
                "Only the refresh call can tell a rejected session from an unreachable server. Let refreshAccessToken decide, or handle the failure without ending the session.",
            },
            {
              name: "@/features/auth/utils/auth-state-cookie",
              importNames: ["clearAuthStateCookie"],
              message:
                "Retracting the hint is a teardown. It belongs to token-manager, which knows whether the server actually refused.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // Any receiver, any spelling: `document.cookie`, `document["cookie"]`,
          // `globalThis.document.cookie`, or an alias held in a variable.
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.property.name='cookie']",
          message:
            "Writing a cookie by hand can retract the session hint without telling the server, which reports the visitor as signed out while their refresh token stays live. Cookie writes belong in auth-state-cookie.ts or consent-storage.ts.",
        },
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.property.value='cookie']",
          message:
            "Writing a cookie by hand can retract the session hint without telling the server, which reports the visitor as signed out while their refresh token stays live. Cookie writes belong in auth-state-cookie.ts or consent-storage.ts.",
        },
        {
          // The server-side equivalent, which carries no `document`.
          selector:
            "CallExpression[callee.property.name=/^(set|append)$/] > Literal[value=/^set-cookie$/i]",
          message:
            "Setting a Set-Cookie header here bypasses the one place that owns session cookies. proxy.ts routes on the hint, so a delete written here strands the visitor exactly as the original bug did.",
        },
      ],
    },
  },
  // The two files that own cookie writes: one performs the delete
  // `token-manager` asks for, the other handles an unrelated, non-credential
  // cookie. Neither decides that a session is over.
  {
    files: [
      "features/auth/utils/auth-state-cookie.ts",
      "features/cookie-consent/utils/consent-storage.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  // Owns the rejected-versus-unreachable distinction, and the explicit user
  // action, respectively.
  {
    files: [
      "features/auth/utils/token-manager.ts",
      "features/auth/context/auth-context.tsx",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default eslintConfig;

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
  // from anywhere else signs people out over a redeploy, with a valid refresh
  // cookie still in the jar and the hint gone that would have let it be used.
  //
  // This rule has been rewritten several times, and every earlier version
  // failed the same way: it enumerated spellings -- helper names, receiver
  // names, file extensions, import specifiers -- and an enumeration is always
  // one spelling short. Adversarial audits walked past those versions with
  // bracket notation, a renamed local, a relative import, a `.jsx` file, a
  // dynamic `import()`, and a wrapper exported from the owner file itself.
  //
  // So this version stops enumerating twice over. Imports are an ALLOWLIST:
  // a new export from token-manager is blocked by default rather than needing
  // to be added to a list of forbidden names. And cookie mutation is keyed on
  // the hint's own name rather than on the receiver, so `store.delete(NAME)`,
  // `jar.delete(NAME)` and `(await cookies()).delete(NAME)` are all the same
  // to it, while the six files that legitimately `.get(NAME)` stay silent.
  //
  // Two things it still cannot see, both semantic rather than syntactic, and
  // both left to review and to the behavioural tests in
  // `tests/auth-session-probe.test.tsx`: a bulk cookie sweep in
  // `consent-storage.ts` that happens to include the hint, and a bad teardown
  // decision inside one of the files that is allowed to make them.
  {
    files: ["**/*.{js,jsx,cjs,mjs,cts,mts,ts,tsx}"],
    ignores: ["tests/**", "e2e/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // Patterns rather than `paths`, because `paths` matches the
          // specifier literally and relative imports are the house style
          // inside `features/auth/`. `allowImportNames` rather than
          // `importNames`, because a forbidden-name list is defeated by
          // adding a differently-named export that does the same thing.
          patterns: [
            {
              group: [
                "**/token-manager",
                "*/token-manager",
                "./token-manager",
              ],
              allowImportNames: ["refreshAccessToken"],
              message:
                "Only the refresh call can tell a rejected session from an unreachable server. Ending a session from anywhere else signs people out over a redeploy, with a valid refresh cookie still in the jar.",
            },
            {
              group: [
                "**/auth-state-cookie",
                "*/auth-state-cookie",
                "./auth-state-cookie",
              ],
              allowImportNames: [
                "AUTH_STATE_COOKIE_NAME",
                "AUTH_STATE_COOKIE_VALUE",
                "hasAuthStateCookie",
                "subscribeToAuthStateCookie",
              ],
              message:
                "Reading the session hint is fine; retracting it is a teardown, and belongs to token-manager, which knows whether the server actually refused.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // Any receiver, any spelling: `document.cookie`,
          // `document["cookie"]`, `globalThis.document.cookie`, or an alias
          // held in a variable.
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
          // Keyed on the cookie, not on what is holding it: a Server Action
          // doing `const store = await cookies(); store.delete(NAME)` is the
          // same act as `cookieStore.delete(NAME)`, and naming the local
          // variable differently must not change the answer.
          selector:
            "CallExpression[callee.property.name=/^(set|delete)$/] > Identifier[name='AUTH_STATE_COOKIE_NAME']",
          message:
            "Setting or deleting the session hint here bypasses the one place that owns it. proxy.ts routes on this cookie, so retracting it without telling the server reports the visitor as signed out while their refresh token stays live and spendable.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(set|delete)$/] > Literal[value='league_analysis_auth_state']",
          message:
            "Setting or deleting the session hint here bypasses the one place that owns it. proxy.ts routes on this cookie, so retracting it without telling the server reports the visitor as signed out while their refresh token stays live and spendable.",
        },
        {
          // The raw header form, with the header name in any shape.
          selector:
            "CallExpression[callee.property.name=/^(set|append)$/][callee.object.property.name='headers']",
          message:
            "Set response headers that carry cookies through the module that owns them. A Set-Cookie written here can retract the session hint that proxy.ts routes on.",
        },
        {
          // `no-restricted-imports` never visits ImportExpression, so a
          // dynamic import is invisible to the allowlist above.
          selector: "ImportExpression[source.value=/(token-manager)$/]",
          message:
            "Importing the session teardown dynamically evades the import allowlist. Only the refresh call may end a session.",
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

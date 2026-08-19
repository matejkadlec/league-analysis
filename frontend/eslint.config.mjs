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
  // What it still cannot see is anything semantic rather than syntactic: a
  // bulk cookie sweep in `consent-storage.ts` that happens to include the
  // hint, a bad teardown decision inside a file allowed to make them, and a
  // teardown reached through `useAuth().logout()` -- which arrives by React
  // context, not by a module specifier, so no import rule will ever see it.
  // Those belong to `tests/auth-teardown-behaviour.test.tsx`, which asserts
  // the effect instead of recognising the shape, and which caught two escapes
  // these rules could not.
  //
  // But that test file is an enumeration too -- of surfaces, and a new
  // component with a query and a `logout()` is a fresh hole in it. The layer
  // that scales is neither of these: it is that the signals a caller reads no
  // longer lie. `refreshAccessToken` returns a `SessionRefresh` naming what it
  // found rather than a falsy value meaning both "refused" and "unreachable",
  // and `api.ts` forwards that verbatim rather than passing on a 401 the
  // refresh could not resolve. So `if (kind === "authentication") logout()`
  // and `if (!(await refreshAccessToken())) logout()` -- the two shapes a
  // future author is most likely to reach for, and the two nothing here can
  // see -- are now correct code and dead code respectively, rather than the
  // teardowns that walked past every version of this rule.
  //
  // The cookie-mutation rule is deliberately receiver-free, which costs one
  // false positive: a `Map` keyed by the cookie's name is flagged too.
  // Narrowing it to particular receivers is what let `store.delete(NAME)`
  // through while refusing `cookieStore.delete(NAME)`, so the noise is the
  // cheaper side of that trade.
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
                "**/auth/utils/token-manager",
                "../utils/token-manager",
                "./utils/token-manager",
                "./token-manager",
              ],
              allowImportNames: ["refreshAccessToken"],
              message:
                "Only the refresh call can tell a rejected session from an unreachable server. Ending a session from anywhere else signs people out over a redeploy, with a valid refresh cookie still in the jar.",
            },
            {
              group: [
                "**/auth/utils/auth-state-cookie",
                "../utils/auth-state-cookie",
                "./utils/auth-state-cookie",
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
            "CallExpression[callee.property.name=/^(set|delete)$/] Identifier[name='AUTH_STATE_COOKIE_NAME']",
          message:
            "Setting or deleting the session hint here bypasses the one place that owns it. proxy.ts routes on this cookie, so retracting it without telling the server reports the visitor as signed out while their refresh token stays live and spendable.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(set|delete)$/] Literal[value='league_analysis_auth_state']",
          message:
            "Setting or deleting the session hint here bypasses the one place that owns it. proxy.ts routes on this cookie, so retracting it without telling the server reports the visitor as signed out while their refresh token stays live and spendable.",
        },
        {
          // A cookie can also be retracted by writing the raw header, which
          // spells neither `.delete` nor the cookie's own name -- an early
          // audit escaped through exactly that in `proxy.ts`. Keyed on the
          // header rather than on the payload, so a `Set-Cookie` assembled
          // from fragments is caught too. Nothing in the tree writes this
          // header today, so it costs nothing to forbid.
          selector:
            "CallExpression[callee.property.name=/^(set|append)$/][arguments.0.value=/^set-cookie$/i]",
          message:
            "Writing a Set-Cookie header by hand can retract the session hint without telling the server, which reports the visitor as signed out while their refresh token stays live. Cookie writes belong in auth-state-cookie.ts or the backend.",
        },
        {
          // `no-restricted-imports` never visits ImportExpression, so a
          // dynamic import is invisible to the allowlist above.
          selector:
            "ImportExpression[source.value=/auth\\/utils\\/(token-manager|auth-state-cookie)$/]",
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

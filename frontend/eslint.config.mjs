import { fixupConfigRules } from "@eslint/compat";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// Hoisted because two blocks below need them, and a flat-config block
// REPLACES a rule's options for the files it matches rather than merging
// them. A later block that sets `no-restricted-imports` for one file silently
// drops this allowlist there -- which is what happened to `proxy.ts`, turning
// the file the design treats as most dangerous into the only one allowed to
// import the teardown helpers.
export const sessionTeardownImports = [
          {
            // Trailing `*` because a specifier may carry an extension:
            // `.../token-manager.js` matched none of these patterns and
            // resolves to the same module.
            group: [
              "**/auth/utils/token-manager*",
              "../utils/token-manager*",
              "./utils/token-manager*",
              "./token-manager*",
            ],
            allowImportNames: ["refreshAccessToken"],
            message:
              "Only the refresh call can tell a rejected session from an unreachable server. Ending a session from anywhere else signs people out over a redeploy, with a valid refresh cookie still in the jar.",
          },
          {
            group: [
              "**/auth/utils/auth-state-cookie*",
              "../utils/auth-state-cookie*",
              "./utils/auth-state-cookie*",
              "./auth-state-cookie*",
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
];

export const sessionTeardownSyntax = [
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
    // The same header as an object property rather than an argument:
    // `NextResponse.json(data, { headers: { "Set-Cookie": ... } })` and
    // `new Headers({ "Set-Cookie": ... })`. Two forms, because the rule
    // above sees neither.
    selector: "Property[key.value=/^set-cookie$/i]",
    message:
      "Writing a Set-Cookie header by hand can retract the session hint without telling the server, which reports the visitor as signed out while their refresh token stays live. Cookie writes belong in auth-state-cookie.ts or the backend.",
  },
  {
    // `no-restricted-imports` never visits ImportExpression, so a
    // dynamic import is invisible to the allowlist above.
    selector:
      "ImportExpression[source.value=/auth\\/utils\\/(token-manager|auth-state-cookie)/]",
    message:
      "Importing the session teardown dynamically evades the import allowlist. Only the refresh call may end a session.",
  },
  {
    // And a specifier that is not a literal has no `source.value` at
    // all, so `await import(`@/features/auth/utils/${name}`)` is
    // invisible to the rule above as well. Nothing in the tree imports
    // dynamically today, so refusing the unreadable form costs nothing.
    selector: "ImportExpression:not([source.type='Literal'])",
    message:
      "A dynamic import whose specifier is not a literal cannot be checked against the allowlist. Import it statically.",
  },
{
  // Next's own header shape, which is neither of the two above: the config's
  // `headers()` returns `{ key: "Set-Cookie", value }` -- key `key`, so the
  // property selector that matches a `"Set-Cookie":` key never fires. An
  // audit retracted the hint from `next.config.ts` through exactly that, and
  // added `Clear-Site-Data` beside it, which is a third channel and takes the
  // HttpOnly refresh token with it.
  selector:
    "Property[key.name='key'][value.value=/^(set-cookie|clear-site-data)$/i]",
  message:
    "Writing a Set-Cookie or Clear-Site-Data header here can retract the session hint, and Clear-Site-Data takes the refresh token with it. Cookie writes belong in auth-state-cookie.ts or the backend.",
},
{
  selector:
    "CallExpression[callee.property.name=/^(set|append)$/][arguments.0.value=/^clear-site-data$/i]",
  message:
    "Clear-Site-Data wipes the session hint and the HttpOnly refresh cookie with it, while the token stays live server-side. Only the backend ends a session.",
},
{
  selector: "Property[key.value=/^clear-site-data$/i]",
  message:
    "Clear-Site-Data wipes the session hint and the HttpOnly refresh cookie with it, while the token stays live server-side. Only the backend ends a session.",
},
];

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
  // Honest signals are not sufficient on their own, though: an eighth audit
  // read the outcome correctly and *then* called `logout()`, which tore the
  // session down even when its own request never arrived. So the last layer is
  // that the unconditional teardown is opt-in. Plain `logout()` -- what a
  // timer or an effect will write -- changes nothing locally when the server
  // cannot be reached; only a control under someone's finger passes
  // `evenIfTheServerCannotBeReached`. Past that point an escape has to type
  // that flag on a timer, which is a lie stated at the call site rather than a
  // hole here, and no rule in this file could ever discharge it.
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
          patterns: sessionTeardownImports,
        },
      ],
      "no-restricted-syntax": ["error", ...sessionTeardownSyntax],
    },
  },
  // The edge asks nobody anything.
  //
  // `proxy.ts` runs on every request and owns the same cookie the browser
  // does, and two audits reached for the same escape there: probe the API,
  // fold "unreachable" into "signed out", retract the hint. It cannot do
  // better -- it gets one answer or none, and no way to retry with a refresh,
  // which is `refreshAccessToken`'s job and needs the browser. So the edge
  // makes no requests at all. `tests/proxy-session-hint.test.ts` asserts the
  // whole response envelope for every routing case, which catches a teardown
  // whatever channel it uses; this catches the request itself, which that test
  // cannot see when it is made through an imported client rather than the
  // global `fetch` it can spy on.
  {
    // Every name Next will run as the edge, not just the one in the tree:
    // it accepts `proxy`, `middleware` and both under `src/`, and an audit
    // put the probe in `middleware.ts`, where no rule here applied.
    // `pageExtensions` defaults to tsx, ts, jsx, js and the discovery loop
    // takes the LAST match, so a `proxy.tsx` beside `proxy.ts` silently
    // becomes the edge -- and tsconfig drops it from the program, so it lints
    // as a parse error rather than against these rules. Every name Next can
    // resolve is listed, and a test asserts none of them exist.
    files: [
      "proxy.ts",
      "proxy.tsx",
      "proxy.js",
      "proxy.jsx",
      "middleware.ts",
      "middleware.tsx",
      "middleware.js",
      "middleware.jsx",
      "src/proxy.{ts,tsx,js,jsx}",
      "src/middleware.{ts,tsx,js,jsx}",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "The edge cannot tell a refusal from an outage, and cannot retry with a refresh. Asking the API here ends with a session torn down over a redeploy.",
        },
      ],
      // Both lists repeat the shared ones on purpose: this block replaces the
      // repo-wide rule for this file rather than adding to it.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...sessionTeardownImports,
            {
              group: ["axios", "**/lib/core/api", "@/lib/core/api"],
              message:
                "The edge cannot tell a refusal from an outage, and cannot retry with a refresh. Asking the API here ends with a session torn down over a redeploy.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...sessionTeardownSyntax,
        {
          // An allowlist, because banning `fetch` and axios by name is one
          // spelling short the moment the probe moves into a helper: an audit
          // wrote `lib/auth/edge-session.ts` and imported it here, and every
          // rule stayed green. What the edge is allowed to import is a short
          // list, and anything else -- including a helper that exists to make
          // a request -- has to argue with this rule first.
          selector:
            "ImportDeclaration:not([source.value='next/server']):not([source.value='@/features/auth/utils/auth-state-cookie'])",
          message:
            "proxy.ts may import only next/server and the session-hint constants. A helper imported here can make the request this file must never make: the edge cannot tell a refusal from an outage.",
        },
        {
          // `ImportDeclaration` is the static form only. An audit reopened the
          // helper escape verbatim with `await import("@/lib/auth/edge-session")`
          // -- a literal specifier naming any other module was matched by
          // nothing. Every dynamic import here is refused, and so is
          // `export … from`, which loads a module just as effectively.
          selector: "ImportExpression",
          message:
            "proxy.ts may import only next/server and the session-hint constants, statically. A module loaded here can make the request this file must never make.",
        },
        {
          selector: "ExportNamedDeclaration[source], ExportAllDeclaration",
          message:
            "Re-exporting from proxy.ts loads a module the import allowlist never sees. The edge may import only next/server and the session-hint constants.",
        },
        {
          // `no-restricted-globals` sees a bare `fetch` and not a member call.
          selector: "MemberExpression[property.name='fetch']",
          message:
            "The edge cannot tell a refusal from an outage, and cannot retry with a refresh. Asking the API here ends with a session torn down over a redeploy.",
        },
      ],
    },
  },
  // The server-side cookie store, wherever it is opened.
  //
  // A sweep over `getAll()` names nothing the selectors above can see, and it
  // takes the HttpOnly refresh cookie with it, not just the hint. This was
  // scoped to route handlers, then to `app/**`, and both were one spelling
  // short: a Server Action is defined by a `"use server"` directive, not by a
  // path, so it can live in `features/` or `lib/` and neither scope saw it.
  // The five pages that read the hint are the whole exception list, and a
  // sixth reader should be a decision rather than a default.
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    ignores: [
      "tests/**",
      "e2e/**",
      "app/license/page.tsx",
      "app/sign-in/page.tsx",
      "app/privacy-policy/page.tsx",
      "app/cookie-policy/page.tsx",
      "app/join-us/page.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // Spread here too: this block replaces the repo-wide rule for these
          // files rather than adding to it. `eslint-config-contract.test.ts`
          // fails if any block sets this rule without them.
          patterns: sessionTeardownImports,
          paths: [
            {
              name: "next/headers",
              importNames: ["cookies"],
              message:
                "Server code here can write cookies, and a sweep over the store retracts the session hint and the HttpOnly refresh cookie with it while the token stays live server-side. Only the backend ends a session.",
            },
          ],
        },
      ],
    },
  },
  // The five pages that legitimately read the hint server-side. They get the
  // teardown allowlist back and nothing else.
  {
    files: [
      "app/license/page.tsx",
      "app/sign-in/page.tsx",
      "app/privacy-policy/page.tsx",
      "app/cookie-policy/page.tsx",
      "app/join-us/page.tsx",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: sessionTeardownImports }],
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

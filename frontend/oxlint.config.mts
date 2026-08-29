import { defineConfig } from "oxlint";

import {
  EDGE_CLIENT_IMPORTS,
  FEATURE_BARREL_IMPORTS,
  SERVER_COOKIE_STORE_PATHS,
  SESSION_TEARDOWN_IMPORTS,
  restrictedImports,
} from "./.oxlint-plugins/restricted-imports.mts";

// Files whose developer-observability console output is reviewed and kept:
// API validation mismatches, Data Dragon fallbacks, the error reporter, and
// dev-gated auth warns. Everything else goes through the toast adapter.
const CONSOLE_OWNERS = [
  "features/auth/context/auth-context.tsx",
  "lib/core/http/api-error-logging.ts",
  "lib/core/http/api.ts",
  "lib/core/http/client-error-report.ts",
  "lib/core/riot/data-dragon-version.ts",
  "instrumentation.ts",
  "app/client-error-report/route.ts",
];

// The five pages that legitimately read the session hint server-side. A sixth
// reader should be a decision rather than a default.
const HINT_READING_PAGES = [
  "app/license/page.tsx",
  "app/sign-in/page.tsx",
  "app/privacy-policy/page.tsx",
  "app/cookie-policy/page.tsx",
  "app/join-us/page.tsx",
];

// Every name Next will run as the edge, not just the one in the tree: it
// accepts `proxy` and `middleware`, both under `src/` too, and the discovery
// loop takes the LAST match.
const EDGE_FILES = [
  "proxy.ts",
  "proxy.tsx",
  "proxy.js",
  "proxy.jsx",
  "middleware.ts",
  "middleware.tsx",
  "middleware.js",
  "middleware.jsx",
  "src/proxy.ts",
  "src/proxy.tsx",
  "src/proxy.js",
  "src/proxy.jsx",
  "src/middleware.ts",
  "src/middleware.tsx",
  "src/middleware.js",
  "src/middleware.jsx",
];

const NON_APPLICATION = ["tests/**", "e2e/**"];

export default defineConfig({
  plugins: [
    "eslint",
    "typescript",
    "unicorn",
    "oxc",
    "react",
    "nextjs",
    "import",
    "jsx-a11y",
    "promise",
    "vitest",
  ],
  categories: { correctness: "error" },
  ignorePatterns: [
    "node_modules",
    ".next",
    "coverage",
    "test-results",
    "playwright-report",
    "next-env.d.ts",
  ],
  jsPlugins: ["./.oxlint-plugins/index.mts"],
  rules: {
    // The JSX transform makes React an implicit import; Next has never needed
    // it in scope.
    "react/react-in-jsx-scope": "off",

    // `eslint-config-next` spread `eslint-plugin-react-hooks`'s recommended
    // set, which is not a category oxlint has -- so it is listed. Only
    // `config` and `gating` are missing, and both configure the Compiler.
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "error",
    "react-hooks/set-state-in-effect": "error",
    "react-hooks/set-state-in-render": "error",
    "react-hooks/incompatible-library": "error",
    "react-hooks/purity": "error",
    "react-hooks/immutability": "error",
    "react-hooks/refs": "error",
    "react-hooks/globals": "error",
    "react-hooks/error-boundaries": "error",
    "react-hooks/preserve-manual-memoization": "error",
    "react-hooks/static-components": "error",
    "react-hooks/use-memo": "error",
    "react-hooks/unsupported-syntax": "error",

    // Type-aware, and silently inert without `--type-aware` on the command
    // line -- which is why the gate always passes it.
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",

    "no-console": "error",

    "house/session-teardown-syntax": "error",
    "house/no-long-comments": "error",
    "house/no-deferral-comments": "error",
    "house/no-raw-json-parse": "error",
    "house/no-compat-shims": "error",
    "house/no-spread-input-in-query-key": "error",
    "house/require-cn-for-classname-composition": "error",
    "house/require-fetch-timeout": "error",
    "house/require-query-key-factory": "error",
    "house/require-query-signal": "error",

    "vitest/require-mock-type-parameters": "error",

    "typescript/no-base-to-string": "error",

    // Vitest's `expect(actual, message)` takes a second argument; the rule
    // encodes Jest's signature and calls every labelled assertion invalid.
    "vitest/valid-expect": "off",

    // A `findBy*` query throws when the element never appears, so awaiting one
    // is the assertion. Without it here the rule reads those tests as empty.
    "vitest/expect-expect": [
      "error",
      { assertFunctionNames: ["expect", "screen.find*"] },
    ],

    // Three a11y rules `eslint-config-next` did not run, each of which this
    // tree contradicts on purpose and says why at the call site: `tabIndex`,
    // `role="list"` against Tailwind's reset, and a Radix role IS the semantics.
    "jsx-a11y/no-noninteractive-tabindex": "off",
    "jsx-a11y/no-redundant-roles": "off",
    "jsx-a11y/prefer-tag-over-role": "off",
  },
  overrides: [
    // `tests/` and `e2e/` are the only directories the session guards skip.
    // Tests write the cookie to build the scenario they then assert on.
    {
      files: NON_APPLICATION,
      rules: { "house/session-teardown-syntax": "off" },
    },
    {
      files: CONSOLE_OWNERS,
      rules: { "no-console": "off" },
    },
    {
      files: NON_APPLICATION,
      rules: {
        "no-console": "off",
        // A test builds its own fixtures, so it already knows what shape it
        // put in. The rule earns its keep against the API's `unknown` fields.
        "typescript/no-base-to-string": "off",
        // Tests assert behaviour rather than describe it, so they carry the
        // test rule the application files have no use for.
        "house/meaningful-tests": "error",
        // A test names the key it is asserting on; routing that through the
        // factory would hide the thing under test.
        "house/require-query-key-factory": "off",
        // A test's `queryFn` is a stub with nothing to abort; the rule is
        // about the requests the application actually leaves in flight.
        "house/require-query-signal": "off",
        // A test reads back a payload it serialized itself, so there is no
        // foreign shape for a schema to stand between.
        "house/no-raw-json-parse": "off",
      },
    },
    // The repo-wide import guard. Every later block that sets this rule
    // repeats both lists on purpose: an override replaces, it does not merge.
    {
      files: ["**/*.{js,jsx,cjs,mjs,cts,mts,ts,tsx}"],
      excludeFiles: NON_APPLICATION,
      rules: {
        "no-restricted-imports": restrictedImports(
          SESSION_TEARDOWN_IMPORTS,
          FEATURE_BARREL_IMPORTS,
        ),
      },
    },
    // Server code that can open the cookie store, which is everything except
    // the five pages that read the hint.
    {
      files: ["**/*.{ts,tsx,js,jsx}"],
      excludeFiles: [...NON_APPLICATION, ...HINT_READING_PAGES],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [...SESSION_TEARDOWN_IMPORTS, ...FEATURE_BARREL_IMPORTS],
            paths: SERVER_COOKIE_STORE_PATHS,
          },
        ],
      },
    },
    {
      files: HINT_READING_PAGES,
      rules: {
        "no-restricted-imports": restrictedImports(SESSION_TEARDOWN_IMPORTS),
      },
    },
    // The edge asks nobody anything.
    {
      files: EDGE_FILES,
      rules: {
        "house/edge-isolation-syntax": "error",
        "no-restricted-globals": [
          "error",
          {
            name: "fetch",
            message:
              "The edge cannot tell a refusal from an outage, and cannot retry with a refresh. Asking the API here ends with a session torn down over a redeploy.",
          },
        ],
        "no-restricted-imports": restrictedImports(
          SESSION_TEARDOWN_IMPORTS,
          EDGE_CLIENT_IMPORTS,
        ),
      },
    },
    // The two files that own cookie writes: one performs the delete
    // `token-manager` asks for, the other handles an unrelated, non-credential
    // cookie. Neither decides that a session is over.
    {
      files: [
        "lib/session/auth-state-cookie.ts",
        "features/cookie-consent/consent-storage.ts",
      ],
      rules: { "house/session-teardown-syntax": "off" },
    },
    // Owns the rejected-versus-unreachable distinction, and the explicit user
    // action, respectively.
    {
      files: ["lib/session/token-manager.ts", "features/auth/context/auth-context.tsx"],
      rules: { "no-restricted-imports": "off" },
    },
    // Vendored shadcn primitives, which `components/CLAUDE.md` forbids
    // hand-editing. A primitive's heading takes its content from the call
    // site, which is where the rule would have to look.
    {
      files: ["components/ui/**"],
      rules: { "jsx-a11y/heading-has-content": "off" },
    },
    // Plugin sources traverse AST nodes the runtime delivers untyped, and
    // fixtures hold deliberately broken shapes and directive strings that are
    // documentation rather than real suppressions.
    {
      files: [".oxlint-plugins/**"],
      rules: {
        "typescript/no-explicit-any": "off",
        "no-console": "off",
        // A fixture imports the feature internals whose import it is proving
        // a rule catches. This is the plugin directory, not application code.
        "no-restricted-imports": "off",
        // Each fixture proves ONE rule. A second rule reporting on the same
        // line would keep that line's directive "used" after the rule under
        // test regressed, which is the failure the fixtures exist to catch.
        "house/require-fetch-timeout": "off",
      },
    },
    // Each fixture proves its own rule still fires. The rules scoped to one
    // filename above do not reach the fixtures directory, so they are turned
    // back on here by name.
    {
      files: [".oxlint-plugins/fixtures/edge-isolation-syntax.fixture.ts"],
      rules: { "house/edge-isolation-syntax": "error" },
    },
    {
      files: [".oxlint-plugins/fixtures/meaningful-tests.fixture.ts"],
      rules: { "house/meaningful-tests": "error" },
    },
    {
      files: [".oxlint-plugins/fixtures/require-fetch-timeout.fixture.ts"],
      rules: { "house/require-fetch-timeout": "error" },
    },
    {
      files: [".oxlint-plugins/fixtures/require-query-signal.fixture.ts"],
      rules: { "house/require-query-signal": "error" },
    },
    {
      files: [".oxlint-plugins/fixtures/no-raw-json-parse.fixture.ts"],
      rules: { "house/no-raw-json-parse": "error" },
    },
    // The one module that owns the call, and the reason the rule can be
    // absolute everywhere else.
    {
      files: ["lib/core/http/untrusted-json.ts"],
      rules: { "house/no-raw-json-parse": "off" },
    },
  ],
});

// An override REPLACES this rule's whole configuration for the files it
// matches, so a block that sets it and forgets these lists exempts those files
// silently. `tests/oxlint-config-contract.test.ts` fails when one does.

export type ImportRestriction = {
  group: string[];
  allowImportNames?: string[];
  message: string;
};

// Only the refresh call can tell a rejected session (401/403) from a server it
// could not reach. A teardown from anywhere else signs people out over a
// redeploy, with a valid refresh cookie still in the jar.
export const SESSION_TEARDOWN_IMPORTS: readonly ImportRestriction[] = [
  {
    // Trailing `*` because a specifier may carry an extension:
    // `.../token-manager.js` resolves to the same module.
    group: [
      "**/auth/utils/token-manager*",
      "../utils/token-manager*",
      "./utils/token-manager*",
      "./token-manager*",
    ],
    // An allowlist, not a banlist: a banlist is defeated by adding a
    // differently-named export that does the same thing.
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

// Cross-feature deep imports are how untracked package cycles happen. Code in
// the same feature imports relatively, so an absolute two-segment-plus
// specifier is always crossing a feature edge.
export const FEATURE_BARREL_IMPORTS: readonly ImportRestriction[] = [
  {
    group: ["@/features/*/*", "@/features/*/*/**"],
    message:
      "Import feature internals only through the feature's own barrel (@/features/<name>), or relatively from inside the same feature.",
  },
];

// The edge gets one answer or none, and no way to retry with a refresh. A
// client imported here is a request it must never make.
export const EDGE_CLIENT_IMPORTS: readonly ImportRestriction[] = [
  {
    group: ["axios", "**/lib/core/api", "@/lib/core/api"],
    message:
      "The edge cannot tell a refusal from an outage, and cannot retry with a refresh. Asking the API here ends with a session torn down over a redeploy.",
  },
];

// Server code that can write cookies. A sweep over `getAll()` takes the
// HttpOnly refresh cookie with it, not just the hint, and scoping the ban by
// path spells short: a Server Action is a `"use server"` directive, not a path.
export const SERVER_COOKIE_STORE_PATHS = [
  {
    name: "next/headers",
    importNames: ["cookies"],
    message:
      "Server code here can write cookies, and a sweep over the store retracts the session hint and the HttpOnly refresh cookie with it while the token stays live server-side. Only the backend ends a session.",
  },
];

export const restrictedImports = (
  ...patterns: readonly (readonly ImportRestriction[])[]
): ["error", { patterns: ImportRestriction[] }] => [
  "error",
  { patterns: patterns.flat() },
];

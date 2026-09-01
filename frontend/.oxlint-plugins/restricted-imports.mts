// An override REPLACES this rule's whole config; one that forgets these lists
// silently exempts its files. `tests/oxlint-config-contract.test.ts` catches it.

export type ImportRestriction = {
  group: string[];
  allowImportNames?: string[];
  message: string;
};

// Only the refresh call can tell a rejected session (401/403) from an
// unreachable server; a teardown elsewhere signs people out over a redeploy.
export const SESSION_TEARDOWN_IMPORTS: readonly ImportRestriction[] = [
  {
    // Trailing `*` because a specifier may carry an extension:
    // `.../token-manager.js` resolves to the same module.
    group: [
      "**/lib/session/token-manager*",
      "../session/token-manager*",
      "./session/token-manager*",
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
      "**/lib/session/auth-state-cookie*",
      "../session/auth-state-cookie*",
      "./session/auth-state-cookie*",
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

// Cross-feature deep imports are how untracked cycles happen; same-feature code
// imports relatively, so an absolute two-segment specifier crosses a feature edge.
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
    group: ["axios", "**/lib/core/http/api", "@/lib/core/http/api"],
    message:
      "The edge cannot tell a refusal from an outage, and cannot retry with a refresh. Asking the API here ends with a session torn down over a redeploy.",
  },
];

// A sweep over `getAll()` takes the HttpOnly refresh cookie, not just the hint;
// scoping the ban by path misses Server Actions, which are a directive, not a path.
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

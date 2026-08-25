// oxlint has no `no-restricted-syntax`, but selectors work as visitor keys in
// a JS plugin, so this module carries the rule's options unchanged.

// Two rule IDs, not one rule with options: an override replaces a rule's whole
// configuration, so a per-file option list is a trap.

export type SyntaxRestriction = { selector: string; message: string };

const COOKIE_WRITE =
  "Writing a cookie by hand can retract the session hint without telling the server, which reports the visitor as signed out while their refresh token stays live. Cookie writes belong in auth-state-cookie.ts or consent-storage.ts.";
const HINT_MUTATION =
  "Setting or deleting the session hint here bypasses the one place that owns it. proxy.ts routes on this cookie, so retracting it without telling the server reports the visitor as signed out while their refresh token stays live and spendable.";
const HEADER_WRITE =
  "Writing a Set-Cookie header by hand can retract the session hint without telling the server, which reports the visitor as signed out while their refresh token stays live. Cookie writes belong in auth-state-cookie.ts or the backend.";
const CLEAR_SITE_DATA =
  "Clear-Site-Data wipes the session hint and the HttpOnly refresh cookie with it, while the token stays live server-side. Only the backend ends a session.";
const EDGE_SILENCE =
  "The edge cannot tell a refusal from an outage, and cannot retry with a refresh. Asking the API here ends with a session torn down over a redeploy.";

// Only the refresh call may give up on a session. Each selector keys on the
// cookie's own name, not the receiver: enumerating spellings goes one short.
// `tests/auth-teardown-behaviour.test.tsx` owns the React-context teardown.
export const SESSION_TEARDOWN_SYNTAX: readonly SyntaxRestriction[] = [
  // Any receiver, any spelling: `document.cookie`, `document["cookie"]`,
  // `globalThis.document.cookie`, or an alias held in a variable.
  {
    selector:
      "AssignmentExpression[left.type='MemberExpression'][left.property.name='cookie']",
    message: COOKIE_WRITE,
  },
  {
    selector:
      "AssignmentExpression[left.type='MemberExpression'][left.property.value='cookie']",
    message: COOKIE_WRITE,
  },
  // Keyed on the cookie, not on what is holding it: a Server Action doing
  // `const store = await cookies(); store.delete(NAME)` is the same act as
  // `cookieStore.delete(NAME)`.
  {
    selector:
      "CallExpression[callee.property.name=/^(set|delete)$/] Identifier[name='AUTH_STATE_COOKIE_NAME']",
    message: HINT_MUTATION,
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(set|delete)$/] Literal[value='league_analysis_auth_state']",
    message: HINT_MUTATION,
  },
  // A cookie can also be retracted by writing the raw header, which spells
  // neither `.delete` nor the cookie's own name. Keyed on the header rather
  // than on the payload, so a `Set-Cookie` assembled from fragments is caught.
  {
    selector:
      "CallExpression[callee.property.name=/^(set|append)$/][arguments.0.value=/^set-cookie$/i]",
    message: HEADER_WRITE,
  },
  // The same header as an object property rather than an argument:
  // `NextResponse.json(data, { headers: { "Set-Cookie": ... } })`.
  { selector: "Property[key.value=/^set-cookie$/i]", message: HEADER_WRITE },
  // `no-restricted-imports` never visits ImportExpression, so a dynamic
  // import is invisible to the allowlist.
  {
    selector:
      "ImportExpression[source.value=/auth\\/utils\\/(token-manager|auth-state-cookie)/]",
    message:
      "Importing the session teardown dynamically evades the import allowlist. Only the refresh call may end a session.",
  },
  // A non-literal specifier has no `source.value` at all, so
  // `await import(`@/features/auth/utils/${name}`)` is invisible above too.
  {
    selector: "ImportExpression:not([source.type='Literal'])",
    message:
      "A dynamic import whose specifier is not a literal cannot be checked against the allowlist. Import it statically.",
  },
  // Next's own header shape: the config's `headers()` returns
  // `{ key: "Set-Cookie", value }`, so the property selector above never fires.
  {
    selector:
      "Property[key.name='key'][value.value=/^(set-cookie|clear-site-data)$/i]",
    message:
      "Writing a Set-Cookie or Clear-Site-Data header here can retract the session hint, and Clear-Site-Data takes the refresh token with it. Cookie writes belong in auth-state-cookie.ts or the backend.",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(set|append)$/][arguments.0.value=/^clear-site-data$/i]",
    message: CLEAR_SITE_DATA,
  },
  { selector: "Property[key.value=/^clear-site-data$/i]", message: CLEAR_SITE_DATA },
];

// The edge gets one answer or none and cannot retry with a refresh, so it
// makes no requests at all. An allowlist rather than a banlist: banning
// `fetch` and axios by name goes one spelling short of a probe in a helper.
export const EDGE_ISOLATION_SYNTAX: readonly SyntaxRestriction[] = [
  {
    selector:
      "ImportDeclaration:not([source.value='next/server']):not([source.value='@/features/auth/utils/auth-state-cookie']):not([source.value='@/features/auth/utils/public-routes'])",
    message:
      "proxy.ts may import only next/server, the session-hint constants and the public-route list. A helper imported here can make the request this file must never make: the edge cannot tell a refusal from an outage.",
  },
  {
    selector: "ImportExpression",
    message:
      "proxy.ts may import only next/server and the session-hint constants, statically. A module loaded here can make the request this file must never make.",
  },
  {
    selector: "ExportNamedDeclaration[source], ExportAllDeclaration",
    message:
      "Re-exporting from proxy.ts loads a module the import allowlist never sees. The edge may import only next/server and the session-hint constants.",
  },
  // `no-restricted-globals` sees a bare `fetch` and not a member call.
  {
    selector: "MemberExpression[property.name='fetch']",
    message: EDGE_SILENCE,
  },
];

const visitorFor = (
  restrictions: readonly SyntaxRestriction[],
  context: { report: (descriptor: unknown) => void },
) =>
  Object.fromEntries(
    restrictions.map(({ selector, message }) => [
      selector,
      (node: unknown) => {
        context.report({ node, message });
      },
    ]),
  );

export const sessionTeardownSyntaxRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Only the refresh call may end a session; nothing else may write the session-hint cookie or a teardown header.",
    },
    schema: [],
  },
  createOnce(context: { report: (descriptor: unknown) => void }) {
    return visitorFor(SESSION_TEARDOWN_SYNTAX, context);
  },
};

export const edgeIsolationSyntaxRule = {
  meta: {
    type: "problem",
    docs: { description: "The edge makes no requests and imports no helpers." },
    schema: [],
  },
  createOnce(context: { report: (descriptor: unknown) => void }) {
    return visitorFor(EDGE_ISOLATION_SYNTAX, context);
  },
};

// Regression fixture for `house/session-teardown-syntax`. Every directive
// below suppresses a shape the rule MUST flag; the accepted cases carry none.

declare const document: { cookie: string };
declare const headers: {
  set: (name: string, value: string) => void;
  append: (name: string, value: string) => void;
};
declare const store: {
  set: (name: string, value: string) => void;
  delete: (name: string) => void;
};
declare const value: string;
declare const AUTH_STATE_COOKIE_NAME: string;
declare const dynamicName: string;

// MUST flag: the plain cookie write.
export const dotWrite = () => {
  // oxlint-disable-next-line house/session-teardown-syntax
  document.cookie = value;
};

// MUST flag: bracket notation, which a receiver-keyed rule missed.
export const bracketWrite = () => {
  // oxlint-disable-next-line house/session-teardown-syntax
  document["cookie"] = value;
};

// MUST flag: the hint deleted through any receiver, by constant...
export const deleteByConstant = () => {
  store.delete(
    // oxlint-disable-next-line house/session-teardown-syntax
    AUTH_STATE_COOKIE_NAME,
  );
};

// ...and by its literal spelling, which the constant selector cannot see.
export const deleteByLiteral = () => {
  store.delete(
    // oxlint-disable-next-line house/session-teardown-syntax
    "league_analysis_auth_state",
  );
};

// MUST flag: the raw header, which names neither `.delete` nor the cookie.
export const headerArgument = () => {
  // oxlint-disable-next-line house/session-teardown-syntax
  headers.set("Set-Cookie", value);
};

// MUST flag: the same header as an object key, which the argument selector
// never visits.
export const headerProperty = () => ({
  headers: {
    // oxlint-disable-next-line house/session-teardown-syntax
    "Set-Cookie": value,
  },
});

// MUST flag: Next's own header shape, `{ key, value }` -- the key is `key`,
// so the property selector above stays silent. An audit retracted the hint
// from next.config.ts through exactly this.
export const nextHeaderShape = () => ({
  // oxlint-disable-next-line house/session-teardown-syntax
  key: "Set-Cookie",
  value,
});

// MUST flag: Clear-Site-Data, which takes the HttpOnly refresh token too.
export const clearSiteDataArgument = () => {
  // oxlint-disable-next-line house/session-teardown-syntax
  headers.append("Clear-Site-Data", value);
};

export const clearSiteDataProperty = () => ({
  // oxlint-disable-next-line house/session-teardown-syntax
  "Clear-Site-Data": value,
});

// MUST flag: the dynamic import that evades the static import allowlist.
export const dynamicTeardownImport = async () =>
  // oxlint-disable-next-line house/session-teardown-syntax
  import("@/lib/session/token-manager");

// MUST flag: a specifier that is not a literal, which the selector above
// cannot read at all.
export const unreadableImport = async () =>
  // oxlint-disable-next-line house/session-teardown-syntax
  import(`@/lib/session/${dynamicName}`);

// Accepted -- reading the jar is not a teardown.
export const readCookie = () => document.cookie;

// Accepted -- reading the hint is what five pages legitimately do.
export const readHint = (jar: { get: (name: string) => string | undefined }) =>
  jar.get(AUTH_STATE_COOKIE_NAME);

// Accepted -- an unrelated header.
export const unrelatedHeader = () => {
  headers.set("Cache-Control", "no-store");
};

// Accepted -- an unrelated property named `key`.
export const unrelatedKey = { key: "Content-Type", value };

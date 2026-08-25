export const COOKIE_CONSENT_COOKIE_NAME = "league_analysis_cookie_consent";
export const COOKIE_CONSENT_VERSION = "v1";
export const COOKIE_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export const COOKIE_CONSENT_UPDATED_EVENT =
  "league-analysis-cookie-consent-updated";
export const COOKIE_CONSENT_OPEN_PREFERENCES_EVENT =
  "league-analysis-cookie-consent-open-preferences";

/**
 * Every optional-storage key the app writes, owned here rather than by its
 * writer: `match-history-preferences.ts` imports from this module, so the
 * other direction is a cycle. Withdrawing consent erases the derived list.
 */
export const HEADER_MESSAGES_CLOSED_STORAGE_KEY = "header_messages_closed:v1";
export const MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY =
  "league_analysis_match_history_page_size";
export const MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY =
  "league_analysis_match_history_queue_filters";

const OPTIONAL_STORAGE_KEYS = [
  HEADER_MESSAGES_CLOSED_STORAGE_KEY,
  MATCH_HISTORY_PAGE_SIZE_STORAGE_KEY,
  MATCH_HISTORY_QUEUE_FILTERS_STORAGE_KEY,
] as const;

// One spelling of the backend enum, from the module the contract test reads.
import type { CookieConsentLevel } from "@/lib/core/schemas";

export type { CookieConsentLevel };

export interface CookieConsentState {
  level: CookieConsentLevel;
  version: string;
  updatedAt: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function parseCookieConsentValue(rawValue: string): CookieConsentState | null {
  const decoded = decodeURIComponent(rawValue);
  const [version, level, updatedAt] = decoded.split("|");

  if (!version) {
    return null;
  }

  if (level !== "necessary" && level !== "all") {
    return null;
  }

  if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) {
    return null;
  }

  return {
    version,
    level,
    updatedAt,
  };
}

function getCookieValue(name: string): string | null {
  if (!isBrowser()) {
    return null;
  }

  const prefixedName = `${name}=`;
  const parts = document.cookie.split(";");

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefixedName)) {
      continue;
    }
    return trimmed.slice(prefixedName.length);
  }

  return null;
}

function serializeConsent(consent: CookieConsentState): string {
  return `${consent.version}|${consent.level}|${consent.updatedAt}`;
}

export function readCookieConsentFromBrowser(): CookieConsentState | null {
  const rawValue = getCookieValue(COOKIE_CONSENT_COOKIE_NAME);
  if (!rawValue) {
    return null;
  }

  return parseCookieConsentValue(rawValue);
}

export function isCurrentCookieConsent(consent: CookieConsentState): boolean {
  return consent.version === COOKIE_CONSENT_VERSION;
}

export function canUseOptionalStorage(
  consent: CookieConsentState | null = readCookieConsentFromBrowser(),
): boolean {
  if (!consent) {
    return false;
  }

  return isCurrentCookieConsent(consent) && consent.level === "all";
}

export function writeCookieConsent(level: CookieConsentLevel): CookieConsentState {
  if (!isBrowser()) {
    return {
      level,
      version: COOKIE_CONSENT_VERSION,
      updatedAt: new Date().toISOString(),
    };
  }

  const consent: CookieConsentState = {
    level,
    version: COOKIE_CONSENT_VERSION,
    updatedAt: new Date().toISOString(),
  };

  const secure =
    typeof location !== "undefined" && location.protocol === "https:"
      ? "; Secure"
      : "";

  document.cookie =
    `${COOKIE_CONSENT_COOKIE_NAME}=${encodeURIComponent(
      serializeConsent(consent),
    )}; ` +
    `Path=/; Max-Age=${COOKIE_CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;

  return consent;
}

export function clearOptionalBrowserStorage(): void {
  if (!isBrowser()) {
    return;
  }

  // Blocked site data makes every `localStorage` access throw, and this runs
  // in a mount effect above every error boundary: an unguarded throw unmounts
  // the whole tree and hands the visitor a blank page.
  try {
    for (const key of OPTIONAL_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable; nothing to clear.
  }
}

// Optional storage is only readable and writable with current "all" consent,
// and every access needs the same SecurityError guard -- the
// `window.localStorage` getter itself throws when site data is blocked.
export function readOptionalStorage(key: string): string | null {
  if (!isBrowser() || !canUseOptionalStorage()) {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeOptionalStorage(key: string, value: string): void {
  if (!isBrowser() || !canUseOptionalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable; the in-memory value stands.
  }
}

export function notifyCookieConsentUpdated(
  consent: CookieConsentState | null,
): void {
  if (!isBrowser()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<CookieConsentState | null>(COOKIE_CONSENT_UPDATED_EVENT, {
      detail: consent,
    }),
  );
}

export function requestCookieConsentPreferences(): void {
  if (!isBrowser()) {
    return;
  }

  window.dispatchEvent(new Event(COOKIE_CONSENT_OPEN_PREFERENCES_EVENT));
}

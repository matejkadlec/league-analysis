export const COOKIE_CONSENT_COOKIE_NAME = "league_analysis_cookie_consent";
export const COOKIE_CONSENT_VERSION = "v1";
export const COOKIE_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export const COOKIE_CONSENT_UPDATED_EVENT =
  "league-analysis-cookie-consent-updated";
export const COOKIE_CONSENT_OPEN_PREFERENCES_EVENT =
  "league-analysis-cookie-consent-open-preferences";

const OPTIONAL_STORAGE_KEYS = [
  "header_messages_closed",
  "league_analysis_match_history_page_size",
  "league_analysis_match_history_queue_filters",
] as const;

export type CookieConsentLevel = "necessary" | "all";

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

  if (version.length === 0) {
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

  for (const key of OPTIONAL_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
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

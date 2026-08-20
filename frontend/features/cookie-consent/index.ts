export { CookieConsentManager } from "./components/cookie-consent-manager";
export {
  COOKIE_CONSENT_OPEN_PREFERENCES_EVENT,
  COOKIE_CONSENT_UPDATED_EVENT,
  COOKIE_CONSENT_VERSION,
  canUseOptionalStorage,
  clearOptionalBrowserStorage,
  readCookieConsentFromBrowser,
  readOptionalStorage,
  requestCookieConsentPreferences,
  writeOptionalStorage,
} from "./utils/consent-storage";
export type { CookieConsentLevel, CookieConsentState } from "./utils/consent-storage";

"use client";

// The barrel re-exports CookieConsentManager, whose useAuth drags the auth feature into this footer.
// oxlint-disable-next-line no-restricted-imports -- see above: the barrel pulls the auth feature into the shared layer
import { requestCookieConsentPreferences } from "@/features/cookie-consent/consent-storage";

interface CookieSettingsTriggerProps {
  className?: string;
}

export function CookieSettingsTrigger({
  className,
}: CookieSettingsTriggerProps) {
  return (
    <button
      type="button"
      onClick={requestCookieConsentPreferences}
      className={className}
    >
      Cookie settings
    </button>
  );
}

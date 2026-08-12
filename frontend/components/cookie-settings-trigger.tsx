"use client";

import { requestCookieConsentPreferences } from "@/features/cookie-consent";

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

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cookie, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth";
import { api } from "@/lib/core/api";
import {
  COOKIE_CONSENT_OPEN_PREFERENCES_EVENT,
  CookieConsentLevel,
  CookieConsentState,
  canUseOptionalStorage,
  clearOptionalBrowserStorage,
  isCurrentCookieConsent,
  notifyCookieConsentUpdated,
  readCookieConsentFromBrowser,
  writeCookieConsent,
} from "../utils/consent-storage";

export function CookieConsentManager() {
  const { isAuthenticated, user } = useAuth();
  const [isReady, setIsReady] = useState(false);
  const [isBannerOpen, setIsBannerOpen] = useState(false);
  const [consent, setConsent] = useState<CookieConsentState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const lastSyncedKeyRef = useRef<string | null>(null);

  const syncConsentForUser = useCallback(
    async (userId: number, value: CookieConsentState): Promise<void> => {
      const syncKey = `${userId}:${value.version}:${value.level}:${value.updatedAt}`;
      if (lastSyncedKeyRef.current === syncKey) {
        return;
      }

      await api.put("/settings/user/cookie-consent", {
        consent_level: value.level,
        consent_version: value.version,
        consent_source: "banner",
      });
      lastSyncedKeyRef.current = syncKey;
    },
    [],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- Consent state initializes from the browser cookie after hydration. */
  useEffect(() => {
    const storedConsent = readCookieConsentFromBrowser();

    if (!storedConsent || !isCurrentCookieConsent(storedConsent)) {
      clearOptionalBrowserStorage();
      setConsent(null);
      setIsBannerOpen(true);
      notifyCookieConsentUpdated(null);
      setIsReady(true);
      return;
    }

    setConsent(storedConsent);
    setIsBannerOpen(false);
    notifyCookieConsentUpdated(storedConsent);
    setIsReady(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const openPreferences = () => setIsBannerOpen(true);
    window.addEventListener(
      COOKIE_CONSENT_OPEN_PREFERENCES_EVENT,
      openPreferences,
    );

    return () => {
      window.removeEventListener(
        COOKIE_CONSENT_OPEN_PREFERENCES_EVENT,
        openPreferences,
      );
    };
  }, []);

  useEffect(() => {
    if (!isReady || !isAuthenticated || !user?.id || !consent) {
      return;
    }

    if (!isCurrentCookieConsent(consent)) {
      return;
    }

    void syncConsentForUser(user.id, consent).catch(() => {
      // Best-effort persistence for authenticated user audit trail.
    });
  }, [consent, isAuthenticated, isReady, syncConsentForUser, user?.id]);

  const isBlockingConsentDecision = consent === null;

  useEffect(() => {
    if (!isBannerOpen || !isBlockingConsentDecision) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [isBannerOpen, isBlockingConsentDecision]);

  const saveChoice = async (level: CookieConsentLevel) => {
    setIsSaving(true);

    try {
      const nextConsent = writeCookieConsent(level);

      if (level !== "all") {
        clearOptionalBrowserStorage();
      }

      setConsent(nextConsent);
      setIsBannerOpen(false);
      notifyCookieConsentUpdated(nextConsent);

      if (isAuthenticated && user?.id) {
        await syncConsentForUser(user.id, nextConsent);
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (!isReady) {
    return null;
  }

  const optionalStorageEnabled = canUseOptionalStorage(consent);

  return (
    <>
      {isBannerOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[#020b1a]/75 px-4 py-6 backdrop-blur-[2px]"
          onClick={() => {
            if (!isBlockingConsentDecision) {
              setIsBannerOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Cookie and Local Storage Preferences"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-4xl rounded-2xl border border-white/20 bg-[#0a1428]/95 p-5 shadow-2xl"
          >
            <div className="flex flex-wrap items-start gap-4">
              <div className="mt-0.5 rounded-full bg-[#cfa93a]/15 p-2 text-[#f4e6bd]">
                <Cookie className="h-5 w-5" />
              </div>

              <div className="min-w-[260px] flex-1 text-sm text-white/90">
                <p className="flex items-center gap-2 text-base font-semibold text-white">
                  <ShieldCheck className="h-4 w-4 text-[#cfa93a]" />
                  Cookie and Local Storage Preferences
                </p>

                <p className="mt-2 leading-relaxed">
                  We always use strictly necessary storage for sign-in,
                  security, and core app functionality. Optional preference
                  storage only remembers non-essential UI choices (for example
                  dismissed admin notices).
                </p>

                <p className="mt-2 leading-relaxed">
                  Choose your preference below. You can change it anytime
                  using the Cookie settings link in the page footer or from
                  Settings in your account.
                </p>

                <p className="mt-2 text-xs text-white/75">
                  Read more in our{" "}
                  <Link
                    href="/cookie-policy"
                    className="underline decoration-[#cfa93a]/70 underline-offset-2 hover:text-[#f4e6bd]"
                  >
                    Cookie Policy
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/privacy-policy"
                    className="underline decoration-[#cfa93a]/70 underline-offset-2 hover:text-[#f4e6bd]"
                  >
                    Privacy Policy
                  </Link>
                  .
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              {consent && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isSaving}
                  onClick={() => setIsBannerOpen(false)}
                  className="h-11 border border-white/20 px-5 text-white hover:bg-white/10 hover:text-white"
                >
                  Keep current
                </Button>
              )}

              <Button
                type="button"
                disabled={isSaving}
                onClick={() => void saveChoice("necessary")}
                className="cursor-pointer h-11 min-w-[180px] border border-white/35 bg-[#122445] px-5 text-white hover:bg-[#1a315d]"
              >
                Accept necessary
              </Button>

              <Button
                type="button"
                disabled={isSaving}
                onClick={() => void saveChoice("all")}
                className="cursor-pointer h-11 min-w-[180px] border border-[#f2d17a]/80 bg-[#cfa93a] px-5 text-[#07162b] hover:bg-[#e1bc55]"
              >
                Accept all
              </Button>
            </div>

            {!optionalStorageEnabled && consent?.level === "necessary" && (
              <p className="mt-3 text-right text-xs text-white/70">
                Optional preference storage is currently disabled.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

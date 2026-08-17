"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cookie } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/features/auth";
import { api } from "@/lib/core/api";
import { cn } from "@/lib/core/utils";
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
    if (!isAuthenticated || !user?.id) {
      return;
    }

    const storedConsent = readCookieConsentFromBrowser();
    if (!storedConsent || !isCurrentCookieConsent(storedConsent)) {
      return;
    }

    void syncConsentForUser(user.id, storedConsent).catch(() => {
      // Best-effort persistence for authenticated user audit trail.
    });
  }, [isAuthenticated, syncConsentForUser, user?.id]);

  const isBlockingConsentDecision = consent === null;

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
    <Dialog
      open={isBannerOpen}
      onOpenChange={(open) => {
        if (!open && isBlockingConsentDecision) {
          return;
        }
        setIsBannerOpen(open);
      }}
    >
      <DialogContent
        className={cn(
          "max-w-4xl sm:max-w-4xl",
          isBlockingConsentDecision && "[&>button]:hidden",
        )}
        onPointerDownOutside={(event) => {
          if (isBlockingConsentDecision) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isBlockingConsentDecision) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (isBlockingConsentDecision) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cookie className="h-5 w-5 text-[#cfa93a]" />
            Cookie and Local Storage Preferences
          </DialogTitle>
          <DialogDescription>
            We always use strictly necessary storage for sign-in, security, and
            core app functionality. Optional preference storage only remembers
            non-essential UI choices (for example dismissed admin notices).
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Choose your preference below. You can change it anytime using the
          Cookie settings link in the page footer or from Settings in your
          account.
        </p>

        <p className="text-xs text-muted-foreground">
          Read more in our{" "}
          <Link
            href="/cookie-policy"
            className="underline decoration-[#cfa93a]/70 underline-offset-2 hover:text-foreground"
          >
            Cookie Policy
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy-policy"
            className="underline decoration-[#cfa93a]/70 underline-offset-2 hover:text-foreground"
          >
            Privacy Policy
          </Link>
          .
        </p>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          {consent ? (
            <Button
              type="button"
              variant="ghost"
              disabled={isSaving}
              onClick={() => setIsBannerOpen(false)}
              className="py-2 px-4"
            >
              Keep current
            </Button>
          ) : (
            <span />
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              type="button"
              disabled={isSaving}
              onClick={() => void saveChoice("necessary")}
              className="py-2 px-4"
              variant="outline"
            >
              Accept necessary
            </Button>

            <Button
              type="button"
              disabled={isSaving}
              onClick={() => void saveChoice("all")}
              className="button-medium no-rotation py-2 px-4"
            >
              Accept all
            </Button>
          </div>
        </DialogFooter>

        {!optionalStorageEnabled && consent?.level === "necessary" && (
          <p className="text-right text-xs text-muted-foreground">
            Optional preference storage is currently disabled.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

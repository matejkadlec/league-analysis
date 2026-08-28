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
import { unwrap, validatedGet, validatedPut } from "@/lib/core/api";
import {
  UserCookieConsentResponseSchema,
  type UserCookieConsentUpdate,
} from "@/lib/core/schemas";
import { cn } from "@/lib/core/utils";
import {
  COOKIE_CONSENT_OPEN_PREFERENCES_EVENT,
  COOKIE_CONSENT_VERSION,
  CookieConsentLevel,
  CookieConsentState,
  canUseOptionalStorage,
  clearOptionalBrowserStorage,
  isCurrentCookieConsent,
  notifyCookieConsentUpdated,
  readCookieConsentFromBrowser,
  writeCookieConsent,
} from "../utils/consent-storage";

type ConsentReconciliation =
  | { outcome: "adopt"; consent: CookieConsentState }
  | { outcome: "ask" }
  | { outcome: "keep" };

/**
 * Decide what the signed-in account's record means for the cookie already in
 * the browser. The jar is shared, so a second account inherits the first's
 * choice, which must not be recorded as `consent_source: "banner"`.
 */
async function reconcileConsentForAccount(
  userId: number,
  getChooser: () => { userId: number | null } | null,
  syncConsentForUser: (
    userId: number,
    value: CookieConsentState,
  ) => Promise<void>,
  isCancelled: () => boolean,
): Promise<ConsentReconciliation> {
  const result = await validatedGet(
    UserCookieConsentResponseSchema.nullable(),
    "/settings/user/cookie-consent",
  );
  if (isCancelled()) {
    return { outcome: "keep" };
  }
  // A failed read is not evidence of anything. Leaving the browser state
  // alone beats both alternatives: re-asking someone who already decided,
  // and silently keeping a choice that may not be theirs.
  if (!result.success) {
    return { outcome: "keep" };
  }

  const stored = result.data;
  if (stored && stored.consent_version === COOKIE_CONSENT_VERSION) {
    // This account has decided before, so its record is the answer whatever
    // the browser is carrying. `writeCookieConsent` restamps the cookie's
    // timestamp; the true `consented_at` lives on the record.
    const adopted = writeCookieConsent(stored.consent_level);
    if (stored.consent_level !== "all") {
      clearOptionalBrowserStorage();
    }
    return { outcome: "adopt", consent: adopted };
  }

  // Nothing on record for this account -- either it has never answered, or
  // the policy version moved and its answer no longer covers it.
  const browserConsent = readCookieConsentFromBrowser();
  const chooser = getChooser();
  const theyChoseItThemselves =
    chooser !== null && (chooser.userId === null || chooser.userId === userId);
  if (
    theyChoseItThemselves &&
    browserConsent &&
    isCurrentCookieConsent(browserConsent)
  ) {
    await syncConsentForUser(userId, browserConsent).catch(() => {
      // Best-effort persistence for authenticated user audit trail.
    });
    return { outcome: "keep" };
  }

  // Ask, rather than inherit. Nothing is written to this account's audit
  // trail until it answers, and the optional storage the previous consent
  // permitted is cleared in the meantime.
  clearOptionalBrowserStorage();
  return { outcome: "ask" };
}

export function CookieConsentManager() {
  const { isAuthenticated, user } = useAuth();
  // Lifecycle only. `isSaving` stays its own flag because it is orthogonal:
  // the dialog can be closed and a PUT still in flight, and the footer link
  // can reopen it in that window -- which is what the guard below is for.
  const [status, setStatus] = useState<"loading" | "hidden" | "open">(
    "loading",
  );
  const [consent, setConsent] = useState<CookieConsentState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const lastSyncedKeyRef = useRef<string | null>(null);
  // Who answered the banner in this page session: the account id at the time,
  // or `null` for a visitor. This component is never remounted across a
  // sign-out, so a bare boolean would write A's level into B's audit trail.
  const choiceOwnerRef = useRef<{ userId: number | null } | null>(null);

  const syncConsentForUser = useCallback(
    async (userId: number, value: CookieConsentState): Promise<void> => {
      const syncKey = `${userId}:${value.version}:${value.level}:${value.updatedAt}`;
      if (lastSyncedKeyRef.current === syncKey) {
        return;
      }

      unwrap(
        await validatedPut(
          UserCookieConsentResponseSchema,
          "/settings/user/cookie-consent",
          {
            consent_level: value.level,
            consent_version: value.version,
            consent_source: "banner",
          } satisfies UserCookieConsentUpdate,
        ),
      );
      lastSyncedKeyRef.current = syncKey;
    },
    [],
  );

  /* oxlint-disable react/set-state-in-effect -- Consent state initializes from the browser cookie after hydration. */
  useEffect(() => {
    const storedConsent = readCookieConsentFromBrowser();

    if (!storedConsent || !isCurrentCookieConsent(storedConsent)) {
      clearOptionalBrowserStorage();
      setConsent(null);
      notifyCookieConsentUpdated(null);
      setStatus("open");
      return;
    }

    setConsent(storedConsent);
    notifyCookieConsentUpdated(storedConsent);
    setStatus("hidden");
  }, []);
  /* oxlint-enable react/set-state-in-effect */

  useEffect(() => {
    // Only "hidden" may open: during "loading" the cookie has not been read
    // yet, so opening would show the banner to someone who already answered.
    const openPreferences = () =>
      setStatus((current) => (current === "hidden" ? "open" : current));
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

    const userId = user.id;
    let cancelled = false;

    const applyReconciliation = async () => {
      const reconciliation = await reconcileConsentForAccount(
        userId,
        () => choiceOwnerRef.current,
        syncConsentForUser,
        () => cancelled,
      );
      if (cancelled || reconciliation.outcome === "keep") {
        return;
      }

      const next =
        reconciliation.outcome === "adopt" ? reconciliation.consent : null;
      setConsent(next);
      notifyCookieConsentUpdated(next);
      setStatus(next ? "hidden" : "open");
    };

    void applyReconciliation();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, syncConsentForUser, user?.id]);

  const isBlockingConsentDecision = consent === null;

  const saveChoice = async (level: CookieConsentLevel) => {
    setIsSaving(true);

    try {
      const nextConsent = writeCookieConsent(level);
      choiceOwnerRef.current = { userId: user?.id ?? null };

      if (level !== "all") {
        clearOptionalBrowserStorage();
      }

      setConsent(nextConsent);
      notifyCookieConsentUpdated(nextConsent);
      setStatus("hidden");

      if (isAuthenticated && user?.id) {
        // Deliberately best-effort: the browser already holds the choice, and
        // `lastSyncedKeyRef` stays unset, so the next sign-in reconcile
        // retries the audit write.
        await syncConsentForUser(user.id, nextConsent).catch(() => {});
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (status === "loading") {
    return null;
  }

  const optionalStorageEnabled = canUseOptionalStorage(consent);

  return (
    <Dialog
      open={status === "open"}
      onOpenChange={(open) => {
        if (!open && isBlockingConsentDecision) {
          return;
        }
        setStatus(open ? "open" : "hidden");
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
              onClick={() => setStatus("hidden")}
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

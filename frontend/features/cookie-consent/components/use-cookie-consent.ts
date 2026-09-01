"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/features/auth";
import { unwrap, validatedGet, validatedPut } from "@/lib/core/http/api";
import {
  UserCookieConsentResponseSchema,
  type UserCookieConsentUpdate,
} from "@/lib/core/schemas";
import {
  COOKIE_CONSENT_OPEN_PREFERENCES_EVENT,
  COOKIE_CONSENT_VERSION,
  CookieConsentLevel,
  CookieConsentState,
  clearOptionalBrowserStorage,
  isCurrentCookieConsent,
  notifyCookieConsentUpdated,
  readCookieConsentFromBrowser,
  writeCookieConsent,
} from "../consent-storage";

type ConsentReconciliation =
  | { outcome: "adopt"; consent: CookieConsentState }
  | { outcome: "ask" }
  | { outcome: "keep" };

/**
 * The cookie jar is shared, so a second account inherits the first's choice --
 * which must never be recorded as `consent_source: "banner"`.
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
  // A failed read is not evidence: re-asking someone who already decided is as
  // wrong as keeping a choice that may not be theirs.
  if (!result.success) {
    return { outcome: "keep" };
  }

  const stored = result.data;
  if (stored && stored.consent_version === COOKIE_CONSENT_VERSION) {
    // The record wins over whatever the browser carries; `writeCookieConsent`
    // restamps the cookie, so the true `consented_at` lives on the record.
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

  // Ask rather than inherit: nothing reaches this account's audit trail until it
  // answers, and the previous consent's optional storage is cleared meanwhile.
  clearOptionalBrowserStorage();
  return { outcome: "ask" };
}

/**
 * Owns the consent decision and no markup, so the banner's interaction policy can
 * change without touching any of it.
 */
export function useCookieConsent() {
  const { isAuthenticated, user } = useAuth();
  // `isSaving` stays a separate flag: the dialog can be closed with a PUT still in
  // flight, and the footer link can reopen it in that window.
  const [status, setStatus] = useState<"loading" | "hidden" | "open">(
    "loading",
  );
  const [consent, setConsent] = useState<CookieConsentState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const lastSyncedKeyRef = useRef<string | null>(null);
  // The hook is never remounted across a sign-out, so a bare boolean here would
  // write A's level into B's audit trail.
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
        // Best-effort: `lastSyncedKeyRef` stays unset, so the next sign-in reconcile
        // retries the audit write.
        await syncConsentForUser(user.id, nextConsent).catch(() => {});
      }
    } finally {
      setIsSaving(false);
    }
  };

  return {
    status,
    consent,
    isSaving,
    /** Nobody has answered yet, so the dialog may not be dismissed. */
    isBlockingConsentDecision: consent === null,
    saveChoice,
    hideDialog: () => setStatus("hidden"),
  };
}

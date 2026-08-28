"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, AlertTriangle, AlertOctagon, CircleCheck } from "lucide-react";
import { useAuth } from "@/features/auth";
import { HEADER_MESSAGES_CLOSED_STORAGE_KEY } from "@/features/cookie-consent";
import { COOKIE_CONSENT_UPDATED_EVENT } from "@/features/cookie-consent";
// Not through the barrel: `tests/header-messages-credential-health.test.tsx`
// factory-mocks `@/features/cookie-consent` down to the event name.
// oxlint-disable-next-line no-restricted-imports -- see above: the test mocks the barrel
import {
  readOptionalStorage,
  writeOptionalStorage,
} from "@/features/cookie-consent/utils/consent-storage";
import {
  SERVICE_STATUS_QUERY_KEY,
  serviceStatusQueryOptions,
} from "@/lib/core/service-status-query";
import { z } from "zod";

import { parseUntrustedJson } from "@/lib/core/untrusted-json";
import { cn } from "@/lib/core/utils";
import { RIOT_CREDENTIAL_HEALTH_UPDATED_EVENT } from "@/lib/core/riot-credential-health-events";



// Hidden while Riot production-key review is pending.
const SHOW_SIGNED_OUT_RECRUITMENT_BANNER = false;

// Layout lives in the bases; tones carry only color, weight and shadow.
// Every class stays a literal so Tailwind's scanner sees it.
const BANNER_SHELL =
  "w-full h-[40px] fixed top-0 left-0 z-[100] flex items-center justify-center backdrop-blur-sm border-b";
const BANNER_TEXT = "flex items-center gap-2 text-sm px-4 text-center";
const BANNER_DISMISS =
  "cursor-pointer absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full transition-colors hover:text-white";

const BANNER_TONES = {
  amber: {
    shell: "bg-amber-500/75 border-amber-800/50 shadow-sm",
    text: "font-medium text-amber-100",
    dismiss: "hover:bg-amber-900/50 text-amber-100/80",
  },
  emerald: {
    shell: "bg-emerald-600/70 border-emerald-800/50 shadow-sm",
    text: "font-medium text-emerald-100",
    dismiss: "hover:bg-emerald-900/50 text-emerald-100/80",
  },
  red: {
    shell: "bg-red-600/75 border-red-800/50 shadow-md",
    text: "font-semibold text-red-100",
    dismiss: "",
  },
} as const;

// The admin credential banners differ only by tone, icon and copy, so they
// are data. A status with no entry -- "valid" -- renders nothing, which is
// what the ladder these replaced did by falling through.
const CREDENTIAL_BANNERS: Record<
  string,
  {
    tone: keyof typeof BANNER_TONES;
    icon: React.ReactNode;
    body: React.ReactNode;
  }
> = {
  invalid: {
    tone: "red",
    icon: <AlertOctagon className="h-4 w-4 shrink-0" />,
    body: (
      <>
        Riot API Key is invalid or expired. Fetching new data from Riot fails
        until it is replaced in{" "}
        <Link
          href="/settings"
          className="underline hover:text-white transition-colors font-bold"
        >
          settings
        </Link>
        ; everything already stored still reads.
      </>
    ),
  },
  missing: {
    tone: "red",
    icon: <AlertOctagon className="h-4 w-4 shrink-0" />,
    body: (
      <>
        No active Riot API Key is configured. Fetching new data from Riot fails
        until one is added in settings; everything already stored still reads.
      </>
    ),
  },
  unknown: {
    tone: "amber",
    icon: <AlertTriangle className="h-4 w-4 shrink-0" />,
    body: (
      <>
        Riot API Key is configured but has not yet been verified by a direct
        Riot API response.
      </>
    ),
  },
};

function HeaderBanner({
  tone,
  icon,
  onDismiss,
  dismissLabel,
  children,
}: {
  tone: keyof typeof BANNER_TONES;
  icon: React.ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  children: React.ReactNode;
}) {
  const classes = BANNER_TONES[tone];
  return (
    <div className={cn(BANNER_SHELL, classes.shell)}>
      <div className={cn(BANNER_TEXT, classes.text)}>
        {icon}
        <span>{children}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className={cn(BANNER_DISMISS, classes.dismiss)}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

const CLOSED_MESSAGES_SCHEMA = z.array(z.string());

function readClosedMessages(): string[] {
  return (
    parseUntrustedJson(
      CLOSED_MESSAGES_SCHEMA,
      readOptionalStorage(HEADER_MESSAGES_CLOSED_STORAGE_KEY),
    ) ?? []
  );
}

export function HeaderMessages() {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [closedMessages, setClosedMessages] = useState<string[]>(
    readClosedMessages,
  );
  useEffect(() => {
    // The consent cookie is written before this event fires, so re-reading
    // storage is enough -- a withdrawal has already cleared the key.
    const handleConsentUpdated = () => {
      setClosedMessages(readClosedMessages());
    };

    window.addEventListener(COOKIE_CONSENT_UPDATED_EVENT, handleConsentUpdated);

    return () => {
      window.removeEventListener(
        COOKIE_CONSENT_UPDATED_EVENT,
        handleConsentUpdated,
      );
    };
  }, []);

  const closeMessage = (id: string) => {
    if (closedMessages.includes(id)) {
      return;
    }

    const newClosed = [...closedMessages, id];
    setClosedMessages(newClosed);
    writeOptionalStorage(HEADER_MESSAGES_CLOSED_STORAGE_KEY, JSON.stringify(newClosed));
  };

  const { data: serviceStatus } = useQuery(
    serviceStatusQueryOptions({ enabled: !!isAuthenticated }),
  );

  useEffect(() => {
    const refreshCredentialHealth = () => {
      void queryClient.invalidateQueries({
        queryKey: SERVICE_STATUS_QUERY_KEY,
      });
    };
    window.addEventListener(
      RIOT_CREDENTIAL_HEALTH_UPDATED_EVENT,
      refreshCredentialHealth,
    );
    return () => {
      window.removeEventListener(
        RIOT_CREDENTIAL_HEALTH_UPDATED_EVENT,
        refreshCredentialHealth,
      );
    };
  }, [queryClient]);

  const isAdmin = !!user?.is_admin;
  const maintenanceMessageId = `maintenance_${serviceStatus?.reason ?? "unknown"}_${serviceStatus?.health_revision ?? 0}`;
  const maintenanceRecoveredMessageId = serviceStatus?.recovery_notice_key
    ? `maintenance_resolved_notice_${serviceStatus.recovery_notice_key}`
    : "maintenance_resolved_notice";
  const isNonAdminAuthenticated = isAuthenticated && !isAdmin;
  const isMaintenanceClosed = closedMessages.includes(maintenanceMessageId);
  const isMaintenanceRecoveredClosed = closedMessages.includes(
    maintenanceRecoveredMessageId,
  );
  const isUnderMaintenance = Boolean(serviceStatus?.is_under_maintenance);
  const shouldShowMaintenanceRecovered = Boolean(
    serviceStatus?.has_recent_recovery,
  );

  if (isAuthLoading) {
    return null;
  }

  // Signed-out recruitment banner (hidden while Riot review is pending)
  if (
    SHOW_SIGNED_OUT_RECRUITMENT_BANNER &&
    !isAuthenticated &&
    !(pathname === "/join-us" || pathname.startsWith("/join-us/"))
  ) {
    return (
      <div className="fixed left-0 top-0 z-[100] flex min-h-[40px] w-full items-center justify-center border-b border-emerald-800/50 bg-emerald-600/60 px-2 py-1 shadow-md backdrop-blur-lg">
        <div className="px-4 text-center text-xs font-semibold leading-tight text-emerald-100 sm:text-sm">
          League Analysis is in closed beta and we are actively looking for
          volunteer full-stack developers and beta testers to join our project.
          Interested? Apply{" "}
          <Link
            href="/join-us"
            className="font-bold underline transition-colors hover:text-white"
          >
            here
          </Link>
          .
        </div>
      </div>
    );
  }

  // Non-admin maintenance message (closable)
  if (isNonAdminAuthenticated) {
    if (isUnderMaintenance && !isMaintenanceClosed) {
      return (
        <HeaderBanner
          tone="amber"
          icon={<AlertTriangle className="h-4 w-4 shrink-0" />}
          onDismiss={() => closeMessage(maintenanceMessageId)}
          dismissLabel="Dismiss maintenance message"
        >
          Application is under maintenance. Most functionality may not work
          right now. We will notify you once maintenance is completed.
        </HeaderBanner>
      );
    }

    if (
      !isUnderMaintenance &&
      shouldShowMaintenanceRecovered &&
      !isMaintenanceRecoveredClosed
    ) {
      return (
        <HeaderBanner
          tone="emerald"
          icon={<CircleCheck className="h-4 w-4 shrink-0" />}
          onDismiss={() => closeMessage(maintenanceRecoveredMessageId)}
          dismissLabel="Dismiss maintenance completed message"
        >
          Maintenance is completed and the app is running again. You can safely
          dismiss this message.
        </HeaderBanner>
      );
    }

    return null;
  }

  // Admin messages, based only on the backend-owned state for the effective
  // generation.
  const credentialBanner = isAdmin
    ? CREDENTIAL_BANNERS[serviceStatus?.credential_status ?? ""]
    : undefined;

  if (credentialBanner) {
    return (
      <HeaderBanner tone={credentialBanner.tone} icon={credentialBanner.icon}>
        {credentialBanner.body}
      </HeaderBanner>
    );
  }

  return null;
}

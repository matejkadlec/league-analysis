"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, AlertTriangle, AlertOctagon, CircleCheck } from "lucide-react";
import { useAuth } from "@/features/auth";
import {
  COOKIE_CONSENT_UPDATED_EVENT,
  canUseOptionalStorage,
  type CookieConsentState,
} from "@/features/cookie-consent";
import { api } from "@/lib/core/api";
import { RIOT_CREDENTIAL_HEALTH_UPDATED_EVENT } from "@/lib/core/riot-credential-health-events";

interface ServiceStatus {
  is_under_maintenance: boolean;
  reason: "ok" | "api_key_missing" | "api_key_invalid";
  active_source: "db" | "env" | "none";
  credential_status: "missing" | "unknown" | "valid" | "invalid";
  health_revision: number;
  observed_at: string;
  has_recent_recovery: boolean;
  recovery_notice_key: string | null;
}

// Temporarily disabled while Riot production-key review is pending.
const SHOW_SIGNED_OUT_RECRUITMENT_BANNER = false;

export function HeaderMessages() {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const optionalStorageEnabledRef = useRef(
    typeof window !== "undefined" && canUseOptionalStorage(),
  );
  // Store closed server-revision message identifiers.
  const [closedMessages, setClosedMessages] = useState<string[]>(() => {
    if (typeof window === "undefined" || !canUseOptionalStorage()) {
      return [];
    }

    try {
      const stored = localStorage.getItem("header_messages_closed:v1");
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (value): value is string => typeof value === "string",
          );
        }
      }
    } catch {
      return [];
    }

    return [];
  });
  useEffect(() => {
    const handleConsentUpdated = (event: Event) => {
      const consent = (event as CustomEvent<CookieConsentState | null>).detail;
      const hasOptionalConsent = consent?.level === "all";

      optionalStorageEnabledRef.current = hasOptionalConsent;

      if (!hasOptionalConsent) {
        setClosedMessages([]);
        return;
      }

      try {
        const stored = localStorage.getItem("header_messages_closed:v1");
        if (!stored) {
          return;
        }
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setClosedMessages(
            parsed.filter((value): value is string => typeof value === "string"),
          );
        }
      } catch {
        setClosedMessages([]);
      }
    };

    window.addEventListener(
      COOKIE_CONSENT_UPDATED_EVENT,
      handleConsentUpdated as EventListener,
    );

    return () => {
      window.removeEventListener(
        COOKIE_CONSENT_UPDATED_EVENT,
        handleConsentUpdated as EventListener,
      );
    };
  }, []);

  const closeMessage = (id: string) => {
    if (closedMessages.includes(id)) {
      return;
    }

    const newClosed = [...closedMessages, id];
    setClosedMessages(newClosed);
    if (optionalStorageEnabledRef.current) {
      localStorage.setItem("header_messages_closed:v1", JSON.stringify(newClosed));
    }
  };

  const { data: serviceStatus } = useQuery({
    queryKey: ["service-status"],
    queryFn: async () => {
      const res = await api.get<ServiceStatus>("/settings/service-status");
      return res.data;
    },
    enabled: !!isAuthenticated,
    staleTime: 5 * 1000,
    refetchInterval: 15 * 1000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const refreshCredentialHealth = () => {
      void queryClient.invalidateQueries({ queryKey: ["service-status"] });
      void queryClient.invalidateQueries({ queryKey: ["apiKeyStatus"] });
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

  // Wait until auth state is known
  if (isAuthLoading) {
    return null;
  }

  // Signed-out recruitment banner (temporarily hidden)
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

  // 2. Non-admin maintenance message (closable)
  if (isNonAdminAuthenticated) {
    if (isUnderMaintenance && !isMaintenanceClosed) {
      return (
        <div className="w-full h-[40px] fixed top-0 left-0 z-[100] flex items-center justify-center bg-amber-500/75 backdrop-blur-sm border-b border-amber-800/50 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-100 px-4 text-center">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Application is under maintenance. Most functionality may not work
              right now. We will notify you once maintenance is completed.
            </span>
          </div>
          <button
            type="button"
            aria-label="Dismiss maintenance message"
            onClick={() => closeMessage(maintenanceMessageId)}
            className="cursor-pointer absolute right-4 top-1/2 -translate-y-1/2 p-2 hover:bg-amber-900/50 rounded-full transition-colors text-amber-100/80 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      );
    }

    if (
      !isUnderMaintenance &&
      shouldShowMaintenanceRecovered &&
      !isMaintenanceRecoveredClosed
    ) {
      return (
        <div className="w-full h-[40px] fixed top-0 left-0 z-[100] flex items-center justify-center bg-emerald-600/70 backdrop-blur-sm border-b border-emerald-800/50 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-100 px-4 text-center">
            <CircleCheck className="h-4 w-4 shrink-0" />
            <span>
              Maintenance is completed and the app is running again. You can
              safely dismiss this message.
            </span>
          </div>
          <button
            type="button"
            aria-label="Dismiss maintenance completed message"
            onClick={() => closeMessage(maintenanceRecoveredMessageId)}
            className="cursor-pointer absolute right-4 top-1/2 -translate-y-1/2 p-2 hover:bg-emerald-900/50 rounded-full transition-colors text-emerald-100/80 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      );
    }

    return null;
  }

  // 3. Admin Messages
  if (isAdmin && serviceStatus) {
    // RED: API Key Invalid/Expired
    // Based only on the backend-owned state for the effective generation.
    if (serviceStatus.credential_status === "invalid") {
      return (
        <div className="w-full h-[40px] fixed top-0 left-0 z-[100] flex items-center justify-center bg-red-600/75 backdrop-blur-sm shadow-md border-b border-red-800/50">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-100 px-4 text-center">
            <AlertOctagon className="h-4 w-4 shrink-0" />
            <span>
              Riot API Key is invalid or expired! Please update it in{" "}
              <Link
                href="/settings"
                className="underline hover:text-white transition-colors font-bold"
              >
                settings
              </Link>{" "}
              to restore functionality.
            </span>
          </div>
        </div>
      );
    }

    // RED: No Key configured at all
    if (serviceStatus.credential_status === "missing") {
      return (
        <div className="w-full h-[40px] fixed top-0 left-0 z-[100] flex items-center justify-center bg-red-600/75 backdrop-blur-sm shadow-md border-b border-red-800/50">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-100 px-4 text-center">
            <AlertOctagon className="h-4 w-4 shrink-0" />
            <span>
              No active Riot API Key found! System cannot function. Please
              configure it in settings
              {process.env.NODE_ENV === "production" ? " " : " or .env "}
              immediately.
            </span>
          </div>
        </div>
      );
    }

    if (serviceStatus.credential_status === "unknown") {
      return (
        <div className="w-full h-[40px] fixed top-0 left-0 z-[100] flex items-center justify-center bg-amber-500/75 backdrop-blur-sm border-b border-amber-800/50 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-100 px-4 text-center">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Riot API Key is configured but has not yet been verified by a
              direct Riot API response.
            </span>
          </div>
        </div>
      );
    }

    // YELLOW: Env Key (Closable - Unique per credential-health revision)
    const envKeyId = `env_key_${serviceStatus.health_revision}`;
    const isClosed = closedMessages.includes(envKeyId);

    // Hide env warning in production (env is standard there)
    if (
      serviceStatus.active_source === "env" &&
      !isClosed &&
      process.env.NODE_ENV !== "production"
    ) {
      return (
        <div className="w-full h-[40px] fixed top-0 left-0 z-[100] flex items-center justify-center bg-amber-500/75 backdrop-blur-sm border-b border-amber-800/50 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-100 px-4 text-center">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Using Riot API Key from environment variables. Consider adding it
              to database for better management. Also note that local server
              {" "}
              <b>needs a restart</b> after environment variable change.
            </span>
          </div>
          <button
            type="button"
            aria-label="Dismiss environment API key warning"
            onClick={() => closeMessage(envKeyId)}
            className="cursor-pointer absolute right-4 top-1/2 -translate-y-1/2 p-2 hover:bg-amber-900/50 rounded-full transition-colors text-amber-100/80 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      );
    }
  }

  return null;
}

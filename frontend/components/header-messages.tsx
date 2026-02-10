"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { X, AlertTriangle, AlertOctagon } from "lucide-react";
import { useAuth } from "@/features/auth";
import { api } from "@/lib/core/api";
import { useApiKeyStatus } from "@/lib/core/api-key-status-context";

interface APIKeyStatus {
  has_db_key: boolean;
  has_env_key: boolean;
  active_source: "db" | "env" | "none";
  env_key_identifier?: string;
}

interface JobExecutionStatus {
  status: string;
  has_api_key_error: boolean;
  started_at?: string;
}

interface JobStatusOverview {
  last_execution?: JobExecutionStatus | null;
}

export function HeaderMessages() {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { isApiKeyInvalid, lastApiKeyValidatedAt } = useApiKeyStatus();
  const pathname = usePathname();
  // Store closed keys as an array of identifiers.
  // For env keys: "env_key_{identifier}".
  const [closedMessages, setClosedMessages] = useState<string[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const stored = localStorage.getItem("header_messages_closed");
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      return [];
    }

    return [];
  });

  const closeMessage = (id: string) => {
    const newClosed = [...closedMessages, id];
    setClosedMessages(newClosed);
    localStorage.setItem("header_messages_closed", JSON.stringify(newClosed));
  };

  const { data: keyStatus } = useQuery({
    queryKey: ["apiKeyStatus"],
    queryFn: async () => {
      const res = await api.get<APIKeyStatus>("/settings/riot_api_key/status");
      return res.data;
    },
    // Only fetch for admins
    enabled: !!isAuthenticated && !!user?.is_admin,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: latestJobStatus } = useQuery({
    queryKey: ["job-status-api-key-monitor"],
    queryFn: async () => {
      const res = await api.get<JobStatusOverview>("/jobs/status/overview");
      return res.data;
    },
    enabled: !!isAuthenticated && !!user?.is_admin,
    refetchInterval: 15000,
    refetchOnWindowFocus: false,
  });

  // Wait until auth state is known
  if (isAuthLoading) {
    return null;
  }

  // Signed-out recruitment banner (shown on public signed-out pages except Join Us)
  if (
    !isAuthenticated &&
    !(pathname === "/join-us" || pathname.startsWith("/join-us/"))
  ) {
    return (
      <div className="fixed left-0 top-0 z-[100] flex min-h-[40px] w-full items-center justify-center border-b border-emerald-800/50 bg-emerald-400/50 px-2 py-1 shadow-md backdrop-blur-lg">
        <div className="px-4 text-center text-xs font-semibold leading-tight text-emerald-100 sm:text-sm">
          We are opening volunteer Beta Tester and Full-Stack Developer
          positions. Interested? Apply{" "}
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

  // 2. HIGHEST PRIORITY: API Key Invalid/Expired
  // Detected from Riot API request failures and background job execution failures.
  // This takes precedence over all other admin messages
  const hasLatestJobApiKeyFailure =
    latestJobStatus?.last_execution?.status === "FAILED" &&
    latestJobStatus.last_execution.has_api_key_error;

  const latestJobFailureTimestamp = latestJobStatus?.last_execution?.started_at
    ? new Date(latestJobStatus.last_execution.started_at).getTime()
    : null;

  const hasFreshJobApiKeyFailure =
    hasLatestJobApiKeyFailure &&
    (lastApiKeyValidatedAt === null ||
      latestJobFailureTimestamp === null ||
      Number.isNaN(latestJobFailureTimestamp) ||
      latestJobFailureTimestamp > lastApiKeyValidatedAt);

  if (isApiKeyInvalid || hasFreshJobApiKeyFailure) {
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

  // 3. Admin Messages
  if (user?.is_admin && keyStatus) {
    // RED: No Key configured at all
    if (keyStatus.active_source === "none") {
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

    // YELLOW: Env Key (Closable - Unique per key)
    const envKeyId = `env_key_${keyStatus.env_key_identifier || "legacy"}`;
    const isClosed = closedMessages.includes(envKeyId);

    // Hide env warning in production (env is standard there)
    if (
      keyStatus.active_source === "env" &&
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
              <b>needs a restart</b> after environment variable change.
            </span>
          </div>
          <button
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

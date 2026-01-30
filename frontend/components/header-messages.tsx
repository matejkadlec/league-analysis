"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { X, AlertTriangle, AlertOctagon, Info } from "lucide-react";
import { useAuth } from "@/features/auth";
import { api } from "@/lib/core/api";

interface APIKeyStatus {
  has_db_key: boolean;
  has_env_key: boolean;
  active_source: "db" | "env" | "none";
}

export function HeaderMessages() {
  const { user, isAuthenticated } = useAuth();
  const [closedMessages, setClosedMessages] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  // Handle mounting to avoid hydration mismatch with localStorage
  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem("header_messages_closed");
      if (stored) {
        setClosedMessages(JSON.parse(stored));
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

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

  if (!mounted) return null;

  // 1. Signed Out Message (Always visible if not authed)
  if (!isAuthenticated) {
    return (
      <div className="w-full h-[40px] absolute top-0 left-0 z-[100] flex items-center justify-center bg-emerald-950/75 backdrop-blur-sm border-b border-emerald-800/50">
        <div className="text-sm font-medium text-emerald-100 flex items-center gap-2 px-4 text-center">
          <Info className="h-4 w-4 shrink-0" />
          <span>
            This project is under active development. Interested in
            contributing? Find more{" "}
            <Link
              href="/join-us"
              className="underline hover:text-white transition-colors font-semibold"
            >
              here
            </Link>
            .
          </span>
        </div>
      </div>
    );
  }

  // 2. Admin Messages
  if (user?.is_admin && keyStatus) {
    // RED: No Key
    if (keyStatus.active_source === "none") {
      return (
        <div className="w-full h-[40px] absolute top-0 left-0 z-[100] flex items-center justify-center bg-red-600/75 backdrop-blur-sm shadow-md border-b border-red-800/50">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-100 animate-pulse px-4 text-center">
            <AlertOctagon className="h-4 w-4 shrink-0" />
            <span>
              CRITICAL: No active Riot API Key found! System cannot function.
              Please configure it in Settings or .env immediately.
            </span>
          </div>
        </div>
      );
    }

    // YELLOW: Env Key (Closable)
    if (
      keyStatus.active_source === "env" &&
      !closedMessages.includes("env_key_warning")
    ) {
      return (
        <div className="w-full h-[40px] absolute top-0 left-0 z-[100] flex items-center justify-center bg-amber-500/75 backdrop-blur-sm border-b border-amber-800/50 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-100 px-4 text-center">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Using Riot API Key from environment variables. Consider adding it
              to Database for better management.
            </span>
          </div>
          <button
            onClick={() => closeMessage("env_key_warning")}
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

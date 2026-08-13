"use client";

import { useEffect } from "react";
import { CircleCheckBig, CircleX, Info, TriangleAlert } from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster } from "sonner";
import {
  appToast,
  TOAST_DEFAULT_DURATION_MS,
  type ToastVariant,
} from "@/lib/core/hooks";

const TOAST_ICON_CLASS = "h-[18px] w-[18px]";
const TOAST_PREVIEW_EVENT = "league-analysis:toast";

interface ToastPreviewDetail {
  variant: ToastVariant;
  title: string;
  description?: string;
  duration?: number;
}

function isToastPreviewDetail(value: unknown): value is ToastPreviewDetail {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const detail = value as Record<string, unknown>;
  const validVariant =
    detail.variant === "success" ||
    detail.variant === "warning" ||
    detail.variant === "error" ||
    detail.variant === "info";

  return (
    validVariant &&
    typeof detail.title === "string" &&
    (detail.description === undefined ||
      typeof detail.description === "string") &&
    (detail.duration === undefined ||
      (typeof detail.duration === "number" &&
        Number.isFinite(detail.duration) &&
        detail.duration > 0))
  );
}

export function ToastHost() {
  const { theme = "system" } = useTheme();

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return;
    }

    const showPreviewToast = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (isToastPreviewDetail(detail)) {
        appToast.toast(detail);
      }
    };

    window.addEventListener(TOAST_PREVIEW_EVENT, showPreviewToast);
    return () =>
      window.removeEventListener(TOAST_PREVIEW_EVENT, showPreviewToast);
  }, []);

  return (
    <Toaster
      position="top-right"
      richColors
      closeButton
      visibleToasts={4}
      duration={TOAST_DEFAULT_DURATION_MS}
      theme={theme as "light" | "dark" | "system"}
      icons={{
        success: (
          <CircleCheckBig
            aria-hidden="true"
            className={`${TOAST_ICON_CLASS} text-[#166534]`}
          />
        ),
        warning: (
          <TriangleAlert
            aria-hidden="true"
            className={`${TOAST_ICON_CLASS} text-[#854d0e]`}
          />
        ),
        error: (
          <CircleX
            aria-hidden="true"
            className={`${TOAST_ICON_CLASS} text-[#991b1b]`}
          />
        ),
        info: (
          <Info
            aria-hidden="true"
            className={`${TOAST_ICON_CLASS} text-[#1e3a8a]`}
          />
        ),
      }}
    />
  );
}

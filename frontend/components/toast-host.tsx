"use client";

import { useEffect } from "react";
import { CircleCheckBig, CircleX, Info, TriangleAlert } from "lucide-react";
import { Toaster } from "sonner";
import { z } from "zod";

import {
  appToast,
  TOAST_DEFAULT_DURATION_MS,
  TOAST_VARIANTS,
} from "@/lib/core/hooks";
import { cn } from "@/lib/core/utils";

const TOAST_ICON_CLASS = "h-[18px] w-[18px]";
const TOAST_PREVIEW_EVENT = "league-analysis:toast";

// The event detail is an untrusted payload off the DOM, so it gets the same
// treatment as wire data in lib/core/schemas. `.finite()` is load-bearing:
// z.number() alone accepts Infinity, which the old guard rejected.
const ToastPreviewDetailSchema = z.object({
  variant: z.enum(TOAST_VARIANTS),
  title: z.string(),
  description: z.string().optional(),
  duration: z.number().finite().positive().optional(),
});

export function ToastHost() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return;
    }

    const showPreviewToast = (event: Event) => {
      const parsed = ToastPreviewDetailSchema.safeParse(
        (event as CustomEvent<unknown>).detail,
      );
      if (parsed.success) {
        // zod's optional infers `| undefined`, which exactOptionalPropertyTypes
        // rejects against ToastOptions' plain optionals — spread only what is set.
        const { variant, title, description, duration } = parsed.data;
        appToast.toast({
          variant,
          title,
          ...(description !== undefined && { description }),
          ...(duration !== undefined && { duration }),
        });
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
      theme="dark"
      icons={{
        success: (
          <CircleCheckBig
            aria-hidden="true"
            className={cn(TOAST_ICON_CLASS, "text-[#166534]")}
          />
        ),
        warning: (
          <TriangleAlert
            aria-hidden="true"
            className={cn(TOAST_ICON_CLASS, "text-[#854d0e]")}
          />
        ),
        error: (
          <CircleX
            aria-hidden="true"
            className={cn(TOAST_ICON_CLASS, "text-[#991b1b]")}
          />
        ),
        info: (
          <Info
            aria-hidden="true"
            className={cn(TOAST_ICON_CLASS, "text-[#1e3a8a]")}
          />
        ),
      }}
    />
  );
}

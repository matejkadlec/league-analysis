import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

import { apiErrorMessage, normalizeApiError } from "./api-error";

export type ToastVariant = "success" | "error" | "warning" | "info";

export const TOAST_DEFAULT_DURATION_MS = 4_000;

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  variant: ToastVariant;
  duration?: number;
  id?: string | number;
}

interface ToastMethodOptions {
  description?: ReactNode;
  duration?: number;
  id?: string | number;
}

type ToastMethodArgument = ToastMethodOptions | string | undefined;

function methodOptions(argument: ToastMethodArgument): ToastMethodOptions {
  return typeof argument === "string"
    ? { description: argument }
    : (argument ?? {});
}

function showToast({
  title,
  description,
  variant,
  duration,
  id,
}: ToastOptions) {
  const options = {
    ...(description !== undefined && { description }),
    ...(duration !== undefined && { duration }),
    ...(id !== undefined && { id }),
  };

  switch (variant) {
    case "success":
      return Object.keys(options).length > 0
        ? sonnerToast.success(title, options)
        : sonnerToast.success(title);
    case "error":
      return Object.keys(options).length > 0
        ? sonnerToast.error(title, options)
        : sonnerToast.error(title);
    case "warning":
      return Object.keys(options).length > 0
        ? sonnerToast.warning(title, options)
        : sonnerToast.warning(title);
    case "info":
      return Object.keys(options).length > 0
        ? sonnerToast.info(title, options)
        : sonnerToast.info(title);
  }
}

function method(
  variant: ToastVariant,
  title: ReactNode,
  argument?: ToastMethodArgument,
) {
  const options = methodOptions(argument);
  return showToast({ title, variant, ...options });
}

export const appToast = {
  toast: showToast,
  success: (title: ReactNode, options?: ToastMethodArgument) =>
    method("success", title, options),
  error: (title: ReactNode, options?: ToastMethodArgument) =>
    method("error", title, options),
  warning: (title: ReactNode, options?: ToastMethodArgument) =>
    method("warning", title, options),
  info: (title: ReactNode, options?: ToastMethodArgument) =>
    method("info", title, options),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
};

export function useToast() {
  return appToast;
}

/**
 * Decide what a failed query should announce, or `null` to stay silent.
 *
 * Kept pure and separate from the cache handler that calls it so the silence
 * rules are testable: a handler that decided inline could only be checked by
 * driving a real QueryClient and intercepting Sonner.
 */
export function queryErrorToast(
  error: unknown,
  meta?: Record<string, unknown>,
): ToastOptions | null {
  const apiError = normalizeApiError(error);

  // The auth gate already redirects on these, so a toast per in-flight query
  // would pile onto a transition the viewer can plainly see.
  if (apiError.kind === "authentication" || apiError.kind === "authorization") {
    return null;
  }

  if (meta?.["silenceErrorToast"] === true) {
    return null;
  }

  return {
    title:
      typeof meta?.["errorTitle"] === "string"
        ? meta["errorTitle"]
        : "Could not load this data",
    description: apiErrorMessage(apiError, "Please try again in a moment."),
    variant: "error",
    // One outage fails every query in flight. Keying by failure kind collapses
    // that into a single toast rather than one per query.
    id: `query-error:${apiError.kind}`,
  };
}

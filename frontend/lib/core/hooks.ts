import type { QueryMeta } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

import { apiErrorMessage, normalizeApiError } from "./api-error";

// One source of truth for the variant names. Sonner exposes a method per
// name and the toast-preview schema parses against this same tuple, so a
// name added here cannot drift out of either.
export const TOAST_VARIANTS = ["success", "error", "warning", "info"] as const;

export type ToastVariant = (typeof TOAST_VARIANTS)[number];

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

  // Sonner names one method per variant and `ToastVariant` is exactly that set
  // of names. The second argument is withheld when there is nothing to put in
  // it, which is what callers asserting a bare `(title)` expect.
  return Object.keys(options).length > 0
    ? sonnerToast[variant](title, options)
    : sonnerToast[variant](title);
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
 * The complete vocabulary of a query's `meta`. A type alias, not an interface:
 * `QueryMeta` resolves to `Register["queryMeta"]` only when it extends
 * `Record<string, unknown>`, which an alias satisfies and an interface cannot.
 */
type AppQueryMeta = {
  /** Some other surface reports this failure; say which in a comment. */
  silenceErrorToast?: true;
  /** Name the thing that failed, instead of "Could not load this data". */
  errorTitle?: string;
};

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: AppQueryMeta;
  }
}

/**
 * Decide what a failed query should announce, or `null` to stay silent. Pure
 * and separate from the cache handler that calls it, so the silence rules are
 * testable without driving a real QueryClient and intercepting Sonner.
 */
export function queryErrorToast(
  error: unknown,
  meta?: QueryMeta,
): ToastOptions | null {
  const apiError = normalizeApiError(error);

  // The auth gate already redirects on these, so a toast per in-flight query
  // would pile onto a transition the viewer can plainly see.
  if (apiError.kind === "authentication" || apiError.kind === "authorization") {
    return null;
  }

  if (meta?.silenceErrorToast) {
    return null;
  }

  return {
    title: meta?.errorTitle ?? "Could not load this data",
    description: apiErrorMessage(apiError, "Please try again in a moment."),
    variant: "error",
    // One outage fails every query in flight. Keying by failure kind collapses
    // that into a single toast rather than one per query.
    id: `query-error:${apiError.kind}`,
  };
}

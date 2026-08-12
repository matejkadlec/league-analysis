import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

export type ToastVariant = "success" | "error" | "warning" | "info";

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

const toastApi = {
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
  return toastApi;
}

"use client";

import {
  CircleCheckBig,
  CircleX,
  Info,
  TriangleAlert,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster } from "sonner";

const TOAST_ICON_CLASS = "h-[18px] w-[18px]";

export function ToastHost() {
  const { theme = "system" } = useTheme();

  return (
    <Toaster
      position="top-right"
      richColors
      duration={4000}
      theme={theme as "light" | "dark" | "system"}
      icons={{
        success: (
          <CircleCheckBig aria-hidden="true" className={TOAST_ICON_CLASS} />
        ),
        warning: (
          <TriangleAlert aria-hidden="true" className={TOAST_ICON_CLASS} />
        ),
        error: <CircleX aria-hidden="true" className={TOAST_ICON_CLASS} />,
        info: <Info aria-hidden="true" className={TOAST_ICON_CLASS} />,
      }}
    />
  );
}

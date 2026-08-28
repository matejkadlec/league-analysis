"use client";

import Link from "next/link";
import { Cookie } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/core/utils";
import { canUseOptionalStorage } from "../utils/consent-storage";
import { useCookieConsent } from "./use-cookie-consent";

export function CookieConsentManager() {
  const {
    status,
    consent,
    isSaving,
    isBlockingConsentDecision,
    saveChoice,
    hideDialog,
  } = useCookieConsent();

  if (status === "loading") {
    return null;
  }

  const optionalStorageEnabled = canUseOptionalStorage(consent);

  return (
    <Dialog
      open={status === "open"}
      onOpenChange={(open) => {
        // Radix only ever asks to close here; the footer link reopens through
        // the hook's event listener.
        if (open || isBlockingConsentDecision) {
          return;
        }
        hideDialog();
      }}
    >
      <DialogContent
        className={cn(
          "max-w-4xl sm:max-w-4xl",
          isBlockingConsentDecision && "[&>button]:hidden",
        )}
        onPointerDownOutside={(event) => {
          if (isBlockingConsentDecision) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isBlockingConsentDecision) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (isBlockingConsentDecision) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cookie className="h-5 w-5 text-[#cfa93a]" />
            Cookie and Local Storage Preferences
          </DialogTitle>
          <DialogDescription>
            We always use strictly necessary storage for sign-in, security, and
            core app functionality. Optional preference storage only remembers
            non-essential UI choices (for example dismissed admin notices).
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Choose your preference below. You can change it anytime using the
          Cookie settings link in the page footer or from Settings in your
          account.
        </p>

        <p className="text-xs text-muted-foreground">
          Read more in our{" "}
          <Link
            href="/cookie-policy"
            className="underline decoration-[#cfa93a]/70 underline-offset-2 hover:text-foreground"
          >
            Cookie Policy
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy-policy"
            className="underline decoration-[#cfa93a]/70 underline-offset-2 hover:text-foreground"
          >
            Privacy Policy
          </Link>
          .
        </p>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          {consent ? (
            <Button
              type="button"
              variant="ghost"
              disabled={isSaving}
              onClick={hideDialog}
              className="py-2 px-4"
            >
              Keep current
            </Button>
          ) : (
            <span />
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              type="button"
              disabled={isSaving}
              onClick={() => void saveChoice("necessary")}
              className="py-2 px-4"
              variant="outline"
            >
              Accept necessary
            </Button>

            <Button
              type="button"
              disabled={isSaving}
              onClick={() => void saveChoice("all")}
              className="button-medium no-rotation py-2 px-4"
            >
              Accept all
            </Button>
          </div>
        </DialogFooter>

        {!optionalStorageEnabled && consent?.level === "necessary" && (
          <p className="text-right text-xs text-muted-foreground">
            Optional preference storage is currently disabled.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

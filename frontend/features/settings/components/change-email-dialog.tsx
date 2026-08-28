"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/core/utils";
import { Loader2, Mail, RefreshCcw, Send, StopCircle } from "lucide-react";
import { EmailCodeInputs } from "./email-code-inputs";

interface ChangeEmailDialogProps {
  open: boolean;
  step: "email" | "code";
  newEmail: string;
  newEmailError: string | null;
  emailCodeDigits: string[];
  emailCodeError: string | null;
  isSubmitting: boolean;
  isRequestingCode: boolean;
  onOpenChange: (open: boolean) => void;
  onNewEmailChange: (value: string) => void;
  onDigitsChange: (digits: string[]) => void;
  onClearEmailError: () => void;
  onClearCodeError: () => void;
  onSubmit: () => void;
  onResendCode: () => void;
}

export function ChangeEmailDialog({
  open,
  step,
  newEmail,
  newEmailError,
  emailCodeDigits,
  emailCodeError,
  isSubmitting,
  isRequestingCode,
  onOpenChange,
  onNewEmailChange,
  onDigitsChange,
  onClearEmailError,
  onClearCodeError,
  onSubmit,
  onResendCode,
}: ChangeEmailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-[#cfa93a]" />
            Change Email
          </DialogTitle>
          <DialogDescription>
            Verify ownership of your new email address before applying the
            change.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-left">
          {step === "email" ? (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-email">New email</Label>
                <Input
                  id="new-email"
                  type="email"
                  placeholder="john.doe@email.com"
                  value={newEmail}
                  onChange={(event) => {
                    onNewEmailChange(event.target.value);
                    onClearEmailError();
                  }}
                  disabled={isSubmitting}
                  className="w-full"
                />
              </div>
              {newEmailError && (
                <p className="text-sm text-red-500">{newEmailError}</p>
              )}
              <p className="text-sm text-muted-foreground">
                We will send a code to your new email to verify it.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <EmailCodeInputs
                digits={emailCodeDigits}
                onDigitsChange={onDigitsChange}
                onClearError={onClearCodeError}
                disabled={isSubmitting}
              />

              {emailCodeError && (
                <p className="text-sm text-red-500">{emailCodeError}</p>
              )}

              <button
                type="button"
                className={cn(
                  "text-sm text-muted-foreground cursor-pointer hover:underline",
                  isRequestingCode && "opacity-50",
                )}
                onClick={onResendCode}
                disabled={isRequestingCode}
              >
                <span className="inline-flex items-center gap-1">
                  <RefreshCcw className="h-4 w-4" />
                  Resend the code.
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            type="button"
            className="red-gradient h-10"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            <StopCircle className="h-4 w-4" />
            Cancel
          </Button>

          <button
            type="button"
            className="button-medium lighter no-rotation"
            onClick={onSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Submit
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

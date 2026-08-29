"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, validatedPost } from "@/lib/core/http/api";
import {
  EmailChangeCodeResponseSchema,
  UserResponseSchema,
  type EmailChangeRequest,
  type EmailChangeVerifyRequest,
} from "@/lib/core/schemas";
import { useAuth } from "@/features/auth";
import { useToast } from "@/lib/core/hooks";
import {
  EMAIL_CODE_LENGTH,
  EMAIL_REGEX,
  EMAIL_REQUEST_ERRORS,
  EMAIL_VERIFY_ERRORS,
  USER_QUERY_KEY,
  emptyCodeDigits,
  isEmailLockCode,
  settingsErrorDetail,
} from "../settings-helpers";

/**
 * Where the workflow is and what that step may carry; `null` is closed. A
 * union, so an unentered address cannot coexist with a half-typed code.
 */
type EmailDialogState =
  | { step: "email"; email: string; error: string | null }
  | { step: "code"; email: string; digits: string[]; error: string | null };

export function useChangeEmail() {
  const toast = useToast();
  const { checkAuth } = useAuth();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<EmailDialogState | null>(null);
  // The server's lock is the brake on guessing a six-digit code, so it
  // deliberately outlives the dialog it closed.
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);

  const isEmailChangeLocked = lockedUntil !== null;

  useEffect(() => {
    if (lockedUntil === null) {
      return;
    }

    // Read the clock here rather than during render, so the derived flag
    // stays a pure function of state. A lock restored already expired just
    // gets a zero-delay timer.
    const remainingMs = Math.max(lockedUntil.getTime() - Date.now(), 0);

    const unlockTimer = window.setTimeout(
      () => setLockedUntil(null),
      remainingMs,
    );
    return () => window.clearTimeout(unlockTimer);
  }, [lockedUntil]);

  const closeDialog = () => setDialog(null);

  const handleEmailDialogOpenChange = (open: boolean) => {
    if (!open) {
      closeDialog();
    }
  };

  const applyEmailLock = (isoLockedUntil?: string) => {
    if (isoLockedUntil) {
      setLockedUntil(new Date(isoLockedUntil));
    }
    closeDialog();
    toast.error("Too many failed attempts.", {
      description: "Try again in 5 minutes.",
    });
  };

  const requestEmailCodeMutation = useMutation({
    mutationFn: async (targetEmail: string) => {
      return unwrap(
        await validatedPost(
          EmailChangeCodeResponseSchema,
          "/auth/change-email/request-code",
          { new_email: targetEmail } satisfies EmailChangeRequest,
        ),
      );
    },
    onSuccess: (_data, targetEmail) => {
      void queryClient.invalidateQueries({ queryKey: USER_QUERY_KEY });
      setDialog({
        step: "code",
        email: targetEmail,
        digits: emptyCodeDigits(),
        error: null,
      });
      toast.success("Email verification code sent", {
        description: "Check your new email inbox for the 6-digit code.",
      });
    },
    onError: (error: Error) => {
      const detail = settingsErrorDetail(error);
      const fieldError = detail?.code
        ? EMAIL_REQUEST_ERRORS[detail.code]
        : undefined;

      if (fieldError) {
        setStepError(fieldError);
        return;
      }

      if (isEmailLockCode(detail?.code)) {
        applyEmailLock(detail?.locked_until);
        return;
      }

      toast.error("Email verification code was not sent", {
        description: "Please try again later.",
      });
    },
  });

  const verifyEmailCodeMutation = useMutation({
    mutationFn: async (code: string) => {
      return unwrap(
        await validatedPost(UserResponseSchema, "/auth/change-email/verify", {
          code,
        } satisfies EmailChangeVerifyRequest),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USER_QUERY_KEY });
      setLockedUntil(null);
      closeDialog();
      toast.success("Email address updated");
      void checkAuth();
    },
    onError: (error: Error) => {
      const detail = settingsErrorDetail(error);
      const codeError = detail?.code
        ? EMAIL_VERIFY_ERRORS[detail.code]
        : undefined;

      if (codeError) {
        setStepError(codeError);
        return;
      }

      if (isEmailLockCode(detail?.code)) {
        applyEmailLock(detail?.locked_until);
        return;
      }

      toast.error("Email verification failed", {
        description: "Request a new code and try again.",
      });
    },
  });

  /** Report a failure against whichever step is on screen, if any still is. */
  function setStepError(message: string) {
    setDialog((current) =>
      current === null ? current : { ...current, error: message },
    );
  }

  const handleOpenEmailDialog = () => {
    if (isEmailChangeLocked) {
      toast.error("Too many failed attempts.", {
        description: "Try again in 5 minutes.",
      });
      return;
    }

    setDialog({ step: "email", email: "", error: null });
  };

  /** Typing anywhere in a step retires the error that step was showing. */
  const editEmail = (email: string) =>
    setDialog((current) =>
      current?.step === "email" ? { ...current, email, error: null } : current,
    );

  const editCodeDigits = (digits: string[]) =>
    setDialog((current) =>
      current?.step === "code" ? { ...current, digits, error: null } : current,
    );

  const handleEmailDialogSubmit = () => {
    if (dialog === null) {
      return;
    }

    if (dialog.step === "email") {
      const normalizedEmail = dialog.email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(normalizedEmail)) {
        setStepError("The email address is invalid, check your input.");
        return;
      }

      requestEmailCodeMutation.mutate(normalizedEmail);
      return;
    }

    const combinedCode = dialog.digits.join("");
    if (combinedCode.length !== EMAIL_CODE_LENGTH) {
      setStepError("Enter all 6 digits.");
      return;
    }

    verifyEmailCodeMutation.mutate(combinedCode);
  };

  const handleResendCode = () => {
    if (dialog?.step !== "code") {
      return;
    }

    requestEmailCodeMutation.mutate(dialog.email);
  };

  return {
    dialog,
    isEmailChangeLocked,
    isEmailDialogSubmitting:
      requestEmailCodeMutation.isPending || verifyEmailCodeMutation.isPending,
    isRequestingCode: requestEmailCodeMutation.isPending,
    handleOpenEmailDialog,
    handleEmailDialogOpenChange,
    handleEmailDialogSubmit,
    handleResendCode,
    editEmail,
    editCodeDigits,
  };
}

export type ChangeEmailState = ReturnType<typeof useChangeEmail>;

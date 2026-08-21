"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, validatedPost } from "@/lib/core/api";
import {
  EmailChangeCodeResponseSchema,
  UserResponseSchema,
} from "@/lib/core/schemas";
import { useAuth } from "@/features/auth";
import { useToast } from "@/lib/core/hooks";
import {
  EMAIL_CODE_LENGTH,
  EMAIL_REGEX,
  USER_QUERY_KEY,
  emptyCodeDigits,
  settingsErrorDetail,
} from "./settings-helpers";

export function useChangeEmail() {
  const toast = useToast();
  const { checkAuth } = useAuth();
  const queryClient = useQueryClient();
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailDialogStep, setEmailDialogStep] = useState<"email" | "code">(
    "email",
  );
  const [newEmail, setNewEmail] = useState("");
  const [newEmailError, setNewEmailError] = useState<string | null>(null);
  const [emailCodeDigits, setEmailCodeDigits] = useState(() =>
    emptyCodeDigits(),
  );
  const [emailCodeError, setEmailCodeError] = useState<string | null>(null);
  const [emailChangeLockedUntil, setEmailChangeLockedUntil] =
    useState<Date | null>(null);
  const [lockCheckTimestamp, setLockCheckTimestamp] = useState(0);

  const isEmailChangeLocked =
    emailChangeLockedUntil !== null &&
    emailChangeLockedUntil.getTime() > lockCheckTimestamp;

  useEffect(() => {
    if (!isEmailChangeLocked) {
      return;
    }

    const lockDurationMs =
      emailChangeLockedUntil.getTime() - lockCheckTimestamp;
    if (lockDurationMs <= 0) {
      return;
    }

    const unlockTimer = window.setTimeout(() => {
      setLockCheckTimestamp(Date.now());
    }, lockDurationMs);

    return () => window.clearTimeout(unlockTimer);
  }, [emailChangeLockedUntil, isEmailChangeLocked, lockCheckTimestamp]);

  const resetEmailDialogState = () => {
    setEmailDialogStep("email");
    setNewEmail("");
    setNewEmailError(null);
    setEmailCodeDigits(emptyCodeDigits());
    setEmailCodeError(null);
  };

  const handleEmailDialogOpenChange = (open: boolean) => {
    if (!open) {
      resetEmailDialogState();
    }
    setEmailDialogOpen(open);
  };

  const applyEmailLock = (lockedUntil?: string) => {
    if (lockedUntil) {
      setEmailChangeLockedUntil(new Date(lockedUntil));
      setLockCheckTimestamp(Date.now());
    }
    handleEmailDialogOpenChange(false);
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
          { new_email: targetEmail },
        ),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USER_QUERY_KEY });
      setNewEmailError(null);
      setEmailCodeError(null);
      setEmailCodeDigits(emptyCodeDigits());
      setEmailDialogStep("code");
      toast.success("Email verification code sent", {
        description: "Check your new email inbox for the 6-digit code.",
      });
    },
    onError: (error: Error) => {
      const detail = settingsErrorDetail(error);

      if (detail?.code === "EMAIL_UNCHANGED") {
        setNewEmailError(
          "New email must be different from your current email address.",
        );
        return;
      }

      if (detail?.code === "EMAIL_ALREADY_REGISTERED") {
        setNewEmailError("This email address is already registered.");
        return;
      }

      if (
        detail?.code === "EMAIL_CHANGE_LOCKED" ||
        detail?.code === "EMAIL_CHANGE_TOO_MANY_ATTEMPTS"
      ) {
        applyEmailLock(detail.locked_until);
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
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USER_QUERY_KEY });
      setEmailChangeLockedUntil(null);
      handleEmailDialogOpenChange(false);
      toast.success("Email address updated");
      void checkAuth();
    },
    onError: (error: Error) => {
      const detail = settingsErrorDetail(error);

      if (detail?.code === "EMAIL_CHANGE_INVALID_CODE") {
        setEmailCodeError("This code is incorrect.");
        return;
      }

      if (detail?.code === "EMAIL_CHANGE_CODE_EXPIRED") {
        setEmailCodeError(
          "This code has expired. Use 'Resend the code.' to get a new one.",
        );
        return;
      }

      if (detail?.code === "EMAIL_CHANGE_REQUEST_NOT_FOUND") {
        setEmailCodeError("No active code found. Please resend the code.");
        return;
      }

      if (
        detail?.code === "EMAIL_CHANGE_TOO_MANY_ATTEMPTS" ||
        detail?.code === "EMAIL_CHANGE_LOCKED"
      ) {
        applyEmailLock(detail.locked_until);
        return;
      }

      toast.error("Email verification failed", {
        description: "Request a new code and try again.",
      });
    },
  });

  const handleOpenEmailDialog = () => {
    if (isEmailChangeLocked) {
      toast.error("Too many failed attempts.", {
        description: "Try again in 5 minutes.",
      });
      return;
    }

    setEmailDialogOpen(true);
  };

  const handleRequestEmailCode = () => {
    const normalizedEmail = newEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setNewEmailError("The email address is invalid, check your input.");
      return;
    }

    setNewEmail(normalizedEmail);
    setNewEmailError(null);
    requestEmailCodeMutation.mutate(normalizedEmail);
  };

  const handleVerifyEmailCode = () => {
    const combinedCode = emailCodeDigits.join("");
    if (combinedCode.length !== EMAIL_CODE_LENGTH) {
      setEmailCodeError("Enter all 6 digits.");
      return;
    }

    setEmailCodeError(null);
    verifyEmailCodeMutation.mutate(combinedCode);
  };

  const handleEmailDialogSubmit = () => {
    if (emailDialogStep === "email") {
      handleRequestEmailCode();
      return;
    }

    handleVerifyEmailCode();
  };

  const handleResendCode = () => {
    if (!newEmail) {
      return;
    }

    setEmailCodeError(null);
    requestEmailCodeMutation.mutate(newEmail);
  };

  return {
    emailDialogOpen,
    emailDialogStep,
    newEmail,
    newEmailError,
    emailCodeDigits,
    emailCodeError,
    isEmailChangeLocked,
    isEmailDialogSubmitting:
      requestEmailCodeMutation.isPending || verifyEmailCodeMutation.isPending,
    isRequestingCode: requestEmailCodeMutation.isPending,
    handleOpenEmailDialog,
    handleEmailDialogOpenChange,
    handleEmailDialogSubmit,
    handleResendCode,
    setNewEmail,
    setNewEmailError,
    setEmailCodeDigits,
    setEmailCodeError,
  };
}

export type ChangeEmailState = ReturnType<typeof useChangeEmail>;

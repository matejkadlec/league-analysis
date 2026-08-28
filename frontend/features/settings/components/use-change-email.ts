"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, validatedPost } from "@/lib/core/api";
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
} from "../utils/settings-helpers";

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
          { new_email: targetEmail } satisfies EmailChangeRequest,
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
      const fieldError = detail?.code
        ? EMAIL_REQUEST_ERRORS[detail.code]
        : undefined;

      if (fieldError) {
        setNewEmailError(fieldError);
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
      setEmailChangeLockedUntil(null);
      handleEmailDialogOpenChange(false);
      toast.success("Email address updated");
      void checkAuth();
    },
    onError: (error: Error) => {
      const detail = settingsErrorDetail(error);
      const codeError = detail?.code
        ? EMAIL_VERIFY_ERRORS[detail.code]
        : undefined;

      if (codeError) {
        setEmailCodeError(codeError);
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

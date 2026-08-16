"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  type ApiError,
  validatedPatch,
  validatedPost,
} from "@/lib/core/api";
import {
  EmailChangeCodeResponseSchema,
  MessageResponseSchema,
  UserResponseSchema,
} from "@/lib/core/schemas";
import type { UserProfileUpdate } from "@/lib/core/schemas";
import { useAuth } from "@/features/auth";
import { requestCookieConsentPreferences } from "@/features/cookie-consent";
import { Card } from "@/components/ui/card";
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/core/utils";
import { useToast } from "@/lib/core/hooks";
import {
  Check,
  CircleCheck,
  CircleX,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  RefreshCcw,
  Save,
  Send,
  StopCircle,
  UserCog,
} from "lucide-react";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_CODE_LENGTH = 6;
const PASSWORD_REQUIREMENTS_TEXT =
  "Password must be at least 8 characters long and include at least one uppercase letter, lowercase letter, number, and special character.";
const ACCOUNT_ACTION_BUTTON_CLASS =
  "button-medium no-rotation !h-9 !px-3 !py-2 w-36 justify-center";

interface BackendErrorDetail {
  code?: string | undefined;
  message?: string | undefined;
  locked_until?: string | undefined;
  attempts_remaining?: number | undefined;
}

interface MutationError extends Error {
  code?: string | undefined;
  lockedUntil?: string | undefined;
  attemptsRemaining?: number | undefined;
  status?: number | undefined;
}

function isPasswordStrong(password: string): boolean {
  if (password.length < 8) {
    return false;
  }

  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialCharacter = /[!@#$%^&*(),.?":{}|<>\-_+=\[\]\\/;'`~]/.test(
    password,
  );

  return hasLowercase && hasUppercase && hasNumber && hasSpecialCharacter;
}

function parseBackendErrorDetail(
  apiError: ApiError,
): BackendErrorDetail | null {
  if (!apiError.details || typeof apiError.details !== "object") {
    return null;
  }

  const detailContainer = apiError.details as { detail?: unknown };
  if (!detailContainer.detail || typeof detailContainer.detail !== "object") {
    return null;
  }

  const detail = detailContainer.detail as Record<string, unknown>;
  return {
    code: typeof detail.code === "string" ? detail.code : undefined,
    message: typeof detail.message === "string" ? detail.message : undefined,
    locked_until:
      typeof detail.locked_until === "string" ? detail.locked_until : undefined,
    attempts_remaining:
      typeof detail.attempts_remaining === "number"
        ? detail.attempts_remaining
        : undefined,
  };
}

function toMutationError(apiError: ApiError): MutationError {
  const detail = parseBackendErrorDetail(apiError);
  const error = new Error(detail?.message ?? apiError.message) as MutationError;
  error.code = detail?.code;
  error.lockedUntil = detail?.locked_until;
  error.attemptsRemaining = detail?.attempts_remaining;
  error.status = apiError.status;
  return error;
}

function emptyCodeDigits(): string[] {
  return Array.from({ length: EMAIL_CODE_LENGTH }, () => "");
}


interface AccountSettingsCardProps {
  className?: string;
}

export function AccountSettingsCard({
  className = "lg:col-span-1",
}: AccountSettingsCardProps) {
  const toast = useToast();
  const { user, checkAuth } = useAuth();

  const [draftDisplayName, setDraftDisplayName] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [currentPasswordError, setCurrentPasswordError] = useState<
    string | null
  >(null);

  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailDialogStep, setEmailDialogStep] = useState<"email" | "code">(
    "email",
  );
  const [newEmail, setNewEmail] = useState("");
  const [newEmailError, setNewEmailError] = useState<string | null>(null);
  const [emailCodeDigits, setEmailCodeDigits] =
    useState<string[]>(emptyCodeDigits());
  const [emailCodeError, setEmailCodeError] = useState<string | null>(null);
  const [emailChangeLockedUntil, setEmailChangeLockedUntil] =
    useState<Date | null>(null);
  const [lockCheckTimestamp, setLockCheckTimestamp] = useState(0);
  const emailCodeInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const currentDisplayName = user?.display_name ?? "";
  const displayName = draftDisplayName ?? currentDisplayName;
  const displayNameDirty =
    draftDisplayName !== null && draftDisplayName !== currentDisplayName;

  const isPasswordStrongEnough = useMemo(
    () => isPasswordStrong(newPassword),
    [newPassword],
  );
  const passwordsMatch =
    newPassword.length > 0 && newPassword === repeatPassword;
  const canChangePassword =
    currentPassword.length > 0 &&
    isPasswordStrongEnough &&
    passwordsMatch &&
    repeatPassword.length > 0;
  const canAttemptPasswordChange =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    repeatPassword.length > 0;

  const isEmailChangeLocked =
    emailChangeLockedUntil !== null &&
    emailChangeLockedUntil.getTime() > lockCheckTimestamp;

  useEffect(() => {
    if (!isEmailChangeLocked || emailChangeLockedUntil === null) {
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

  useEffect(() => {
    if (!emailDialogOpen || emailDialogStep !== "code") {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      emailCodeInputRefs.current[0]?.focus();
    }, 60);

    return () => window.clearTimeout(focusTimer);
  }, [emailDialogOpen, emailDialogStep]);

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

  const updateDisplayNameMutation = useMutation({
    mutationFn: async (update: UserProfileUpdate) => {
      const result = await validatedPatch(
        UserResponseSchema,
        "/auth/me",
        update,
      );
      if (!result.success) {
        throw toMutationError(result.error);
      }
      return result.data;
    },
    onSuccess: () => {
      void checkAuth();
      setDraftDisplayName(null);
      toast.success("Display name updated", {
        duration: 1000,
      });
    },
    onError: () => {
      toast.error("Display name was not updated", {
        description: "Please try again later.",
      });
    },
  });

  const requestEmailCodeMutation = useMutation({
    mutationFn: async (targetEmail: string) => {
      const result = await validatedPost(
        EmailChangeCodeResponseSchema,
        "/auth/change-email/request-code",
        { new_email: targetEmail },
      );
      if (!result.success) {
        throw toMutationError(result.error);
      }
      return result.data;
    },
    onSuccess: () => {
      setNewEmailError(null);
      setEmailCodeError(null);
      setEmailCodeDigits(emptyCodeDigits());
      setEmailDialogStep("code");
      toast.success("Email verification code sent", {
        description: "Check your new email inbox for the 6-digit code.",
      });
    },
    onError: (error: Error) => {
      const mutationError = error as MutationError;

      if (mutationError.code === "EMAIL_UNCHANGED") {
        setNewEmailError(
          "New email must be different from your current email address.",
        );
        return;
      }

      if (mutationError.code === "EMAIL_ALREADY_REGISTERED") {
        setNewEmailError("This email address is already registered.");
        return;
      }

      if (
        mutationError.code === "EMAIL_CHANGE_LOCKED" ||
        mutationError.code === "EMAIL_CHANGE_TOO_MANY_ATTEMPTS"
      ) {
        if (mutationError.lockedUntil) {
          setEmailChangeLockedUntil(new Date(mutationError.lockedUntil));
          setLockCheckTimestamp(Date.now());
        }
        handleEmailDialogOpenChange(false);
        toast.error("Too many failed attempts.", {
          description: "Try again in 5 minutes.",
        });
        return;
      }

      toast.error("Email verification code was not sent", {
        description: "Please try again later.",
      });
    },
  });

  const verifyEmailCodeMutation = useMutation({
    mutationFn: async (code: string) => {
      const result = await validatedPost(
        UserResponseSchema,
        "/auth/change-email/verify",
        {
          code,
        },
      );
      if (!result.success) {
        throw toMutationError(result.error);
      }
      return result.data;
    },
    onSuccess: () => {
      setEmailChangeLockedUntil(null);
      handleEmailDialogOpenChange(false);
      toast.success("Email address updated");
      void checkAuth();
    },
    onError: (error: Error) => {
      const mutationError = error as MutationError;

      if (mutationError.code === "EMAIL_CHANGE_INVALID_CODE") {
        setEmailCodeError("This code is incorrect.");
        return;
      }

      if (mutationError.code === "EMAIL_CHANGE_CODE_EXPIRED") {
        setEmailCodeError(
          "This code has expired. Use 'Resend the code.' to get a new one.",
        );
        return;
      }

      if (mutationError.code === "EMAIL_CHANGE_REQUEST_NOT_FOUND") {
        setEmailCodeError("No active code found. Please resend the code.");
        return;
      }

      if (
        mutationError.code === "EMAIL_CHANGE_TOO_MANY_ATTEMPTS" ||
        mutationError.code === "EMAIL_CHANGE_LOCKED"
      ) {
        if (mutationError.lockedUntil) {
          setEmailChangeLockedUntil(new Date(mutationError.lockedUntil));
          setLockCheckTimestamp(Date.now());
        }
        handleEmailDialogOpenChange(false);
        toast.error("Too many failed attempts.", {
          description: "Try again in 5 minutes.",
        });
        return;
      }

      toast.error("Email verification failed", {
        description: "Request a new code and try again.",
      });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      const result = await validatedPost(
        MessageResponseSchema,
        "/auth/change-password",
        {
          current_password: currentPassword,
          new_password: newPassword,
          repeat_password: repeatPassword,
        },
      );

      if (!result.success) {
        throw toMutationError(result.error);
      }

      return result.data;
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setCurrentPasswordError(null);
      toast.success("Password changed");
    },
    onError: (error: Error) => {
      const mutationError = error as MutationError;
      if (mutationError.code === "CURRENT_PASSWORD_INVALID") {
        setCurrentPasswordError("Current password is invalid.");
        return;
      }

      toast.error("Password was not changed", {
        description: "Please try again later.",
      });
    },
  });

  const handleDisplayNameChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const nextDisplayName = event.target.value;
    setDraftDisplayName(
      nextDisplayName === currentDisplayName ? null : nextDisplayName,
    );
  };

  const handleSaveDisplayName = () => {
    const trimmed = displayName.trim();

    if (!trimmed) {
      toast.warning("Enter a display name");
      return;
    }

    if (trimmed.length < 3) {
      toast.warning("Display name too short", {
        description: "Use at least 3 characters.",
      });
      return;
    }

    const validPattern = /^[\p{L}](?:[\p{L}\p{M}_ ]*[\p{L}])?$/u;
    if (!validPattern.test(trimmed)) {
      toast.warning("Check the display name", {
        description:
          "Must only contain letters, underscores, and spaces. Cannot start or end with space or underscore.",
      });
      return;
    }

    if (!/^[\p{L}\p{M}_ ]+$/u.test(trimmed)) {
      toast.warning("Check the display name characters", {
        description:
          "Only letters, underscores, and spaces are allowed in the display name.",
      });
      return;
    }

    updateDisplayNameMutation.mutate({ display_name: trimmed });
  };

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

  const handleEmailCodePaste = (
    event: React.ClipboardEvent<HTMLInputElement>,
  ) => {
    event.preventDefault();

    const pastedText = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, EMAIL_CODE_LENGTH);

    if (!pastedText) {
      return;
    }

    const nextCode = emptyCodeDigits();
    pastedText.split("").forEach((digit, index) => {
      nextCode[index] = digit;
    });

    setEmailCodeDigits(nextCode);
    setEmailCodeError(null);

    const focusIndex = Math.min(pastedText.length, EMAIL_CODE_LENGTH) - 1;
    emailCodeInputRefs.current[Math.max(focusIndex, 0)]?.focus();
  };

  const handleEmailCodeInputChange = (index: number, value: string) => {
    const digitsOnly = value.replace(/\D/g, "");

    if (!digitsOnly) {
      setEmailCodeDigits((previousCode) => {
        const nextCode = [...previousCode];
        nextCode[index] = "";
        return nextCode;
      });
      return;
    }

    setEmailCodeError(null);

    if (digitsOnly.length > 1) {
      setEmailCodeDigits((previousCode) => {
        const nextCode = [...previousCode];
        digitsOnly
          .slice(0, EMAIL_CODE_LENGTH - index)
          .split("")
          .forEach((digit, offset) => {
            nextCode[index + offset] = digit;
          });
        return nextCode;
      });

      const nextFocusIndex = Math.min(
        EMAIL_CODE_LENGTH - 1,
        index + digitsOnly.length,
      );
      emailCodeInputRefs.current[nextFocusIndex]?.focus();
      return;
    }

    setEmailCodeDigits((previousCode) => {
      const nextCode = [...previousCode];
      nextCode[index] = digitsOnly;
      return nextCode;
    });

    if (index < EMAIL_CODE_LENGTH - 1) {
      emailCodeInputRefs.current[index + 1]?.focus();
    }
  };

  const handleEmailCodeKeyDown = (
    index: number,
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (
      event.key === "Backspace" &&
      emailCodeDigits[index] === "" &&
      index > 0
    ) {
      emailCodeInputRefs.current[index - 1]?.focus();
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      emailCodeInputRefs.current[index - 1]?.focus();
      return;
    }

    if (event.key === "ArrowRight" && index < EMAIL_CODE_LENGTH - 1) {
      event.preventDefault();
      emailCodeInputRefs.current[index + 1]?.focus();
    }
  };

  const handleChangePassword = () => {
    if (!canAttemptPasswordChange || changePasswordMutation.isPending) {
      return;
    }

    if (!passwordsMatch) {
      toast.warning("Passwords do not match", {
        description: "Enter the same new password in both fields.",
      });
      return;
    }

    if (!isPasswordStrongEnough) {
      toast.warning("Password requirements not met", {
        description: PASSWORD_REQUIREMENTS_TEXT,
      });
      return;
    }

    setCurrentPasswordError(null);
    changePasswordMutation.mutate();
  };

  const isEmailDialogSubmitting =
    requestEmailCodeMutation.isPending || verifyEmailCodeMutation.isPending;

  return (
    <>
      <Card className={cn("h-full p-6 text-left", className)}>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <UserCog className="h-5 w-5 text-[#cfa93a]" />
          Account Settings
        </h2>

        <TooltipProvider>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="display-name">Display Name</Label>
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-3">
                <Input
                  id="display-name"
                  value={displayName}
                  onChange={handleDisplayNameChange}
                  maxLength={128}
                  disabled={updateDisplayNameMutation.isPending}
                  className="w-full"
                />
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={handleSaveDisplayName}
                    className={ACCOUNT_ACTION_BUTTON_CLASS}
                    disabled={
                      !displayNameDirty || updateDisplayNameMutation.isPending
                    }
                  >
                    {updateDisplayNameMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Save
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="current-email">Current Email</Label>
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-3">
                <Input
                  id="current-email"
                  type="email"
                  value={user?.email ?? ""}
                  disabled
                  className="w-full"
                />
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    className={ACCOUNT_ACTION_BUTTON_CLASS}
                    onClick={handleOpenEmailDialog}
                    disabled={isEmailDialogSubmitting || isEmailChangeLocked}
                  >
                    <Mail className="h-4 w-4" />
                    Change
                  </button>
                </div>
              </div>
              {isEmailChangeLocked && (
                <p className="text-xs text-red-500">
                  Too many failed attempts. Try again in 5 minutes.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current Password</Label>
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-3">
                <div className="relative">
                  <Input
                    id="current-password"
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(event) => {
                      setCurrentPassword(event.target.value);
                      setCurrentPasswordError(null);
                    }}
                    className="w-full pr-10"
                    disabled={changePasswordMutation.isPending}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() =>
                      setShowCurrentPassword((previous) => !previous)
                    }
                    disabled={changePasswordMutation.isPending}
                    aria-label={
                      showCurrentPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-end">
                  <div aria-hidden className="h-9 w-36" />
                </div>
              </div>
              {currentPasswordError && (
                <p className="text-xs text-red-500">{currentPasswordError}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="new-password">New Password</Label>
              </div>
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-3">
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="w-full pr-10"
                    disabled={changePasswordMutation.isPending}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => setShowNewPassword((previous) => !previous)}
                    disabled={changePasswordMutation.isPending}
                    aria-label={
                      showNewPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-end">
                  <div aria-hidden className="h-9 w-36" />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="repeat-password">Repeat Password</Label>
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-3">
                <div className="relative">
                  <Input
                    id="repeat-password"
                    type="password"
                    value={repeatPassword}
                    onChange={(event) => setRepeatPassword(event.target.value)}
                    className="w-full pr-10"
                    disabled={changePasswordMutation.isPending}
                  />
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-center">
                    {canChangePassword ? (
                      <CircleCheck className="h-4 w-4 text-green-500" />
                    ) : (
                      <CircleX className="h-4 w-4 text-red-500" />
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    className={ACCOUNT_ACTION_BUTTON_CLASS}
                    onClick={handleChangePassword}
                    disabled={
                      !canAttemptPasswordChange ||
                      changePasswordMutation.isPending
                    }
                  >
                    {changePasswordMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Changing...
                      </>
                    ) : (
                      <>
                        <KeyRound className="h-4 w-4" />
                        Change
                      </>
                    )}
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground pt-3">
                {PASSWORD_REQUIREMENTS_TEXT}
              </p>
            </div>

            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-end gap-3">
              <div className="space-y-1.5">
                <Label>Cookie settings</Label>
                <p className="text-xs text-muted-foreground">
                  Review and update your cookie preferences.
                </p>
              </div>
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  className={ACCOUNT_ACTION_BUTTON_CLASS}
                  onClick={requestCookieConsentPreferences}
                >
                  <Eye className="h-4 w-4" />
                  View
                </Button>
              </div>
            </div>
          </div>
        </TooltipProvider>
      </Card>

      <Dialog open={emailDialogOpen} onOpenChange={handleEmailDialogOpenChange}>
        <DialogContent className="sm:max-w-[540px] dialog-white-border">
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
            {emailDialogStep === "email" ? (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label htmlFor="new-email">New email</Label>
                  <Input
                    id="new-email"
                    type="email"
                    placeholder="john.doe@email.com"
                    value={newEmail}
                    onChange={(event) => {
                      setNewEmail(event.target.value);
                      setNewEmailError(null);
                    }}
                    disabled={isEmailDialogSubmitting}
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
                <div className="space-y-1.5">
                  <Label>Code</Label>
                  <div className="flex flex-wrap gap-2">
                    {emailCodeDigits.map((digit, index) => (
                      <Input
                        key={index}
                        inputMode="numeric"
                        maxLength={EMAIL_CODE_LENGTH}
                        className="h-10 w-10 text-center"
                        value={digit}
                        onChange={(event) =>
                          handleEmailCodeInputChange(index, event.target.value)
                        }
                        onPaste={handleEmailCodePaste}
                        onKeyDown={(event) =>
                          handleEmailCodeKeyDown(index, event)
                        }
                        ref={(element) => {
                          emailCodeInputRefs.current[index] = element;
                        }}
                        disabled={isEmailDialogSubmitting}
                      />
                    ))}
                  </div>
                </div>

                {emailCodeError && (
                  <p className="text-sm text-red-500">{emailCodeError}</p>
                )}

                <button
                  type="button"
                  className={cn(
                    "text-sm text-muted-foreground cursor-pointer hover:underline",
                    requestEmailCodeMutation.isPending && "opacity-50",
                  )}
                  onClick={handleResendCode}
                  disabled={requestEmailCodeMutation.isPending}
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
              onClick={() => handleEmailDialogOpenChange(false)}
              disabled={isEmailDialogSubmitting}
            >
              <StopCircle className="h-4 w-4" />
              Cancel
            </Button>

            <button
              type="button"
              className="button-medium lighter no-rotation"
              onClick={handleEmailDialogSubmit}
              disabled={isEmailDialogSubmitting}
            >
              {isEmailDialogSubmitting ? (
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
    </>
  );
}

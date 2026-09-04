"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, validatedPost } from "@/lib/core/http/api";
import {
  MessageResponseSchema,
  type PasswordChangeRequest,
} from "@/lib/core/schemas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/core/hooks";
import {
  CircleCheck,
  CircleX,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
} from "lucide-react";
import {
  ACCOUNT_ACTION_BUTTON_CLASS,
  PASSWORD_REQUIREMENTS_TEXT,
  USER_QUERY_KEY,
  isPasswordStrong,
  settingsErrorDetail,
} from "../settings-helpers";

/**
 * A password field with its own show/hide toggle. Local to this file: two
 * uses in one component is one file's worth of abstraction. The visibility
 * flag stays with the form because a successful change resets both to hidden.
 */
function PasswordInput({
  id,
  value,
  onChange,
  disabled,
  visible,
  onVisibleChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full pr-10"
        disabled={disabled}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
        onClick={() => onVisibleChange(!visible)}
        disabled={disabled}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? (
          <EyeOff className="h-4 w-4" />
        ) : (
          <Eye className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

export function PasswordChangeSection() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [currentPasswordError, setCurrentPasswordError] = useState<
    string | null
  >(null);

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

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      return unwrap(
        await validatedPost(MessageResponseSchema, "/auth/change-password", {
          current_password: currentPassword,
          new_password: newPassword,
          repeat_password: repeatPassword,
        } satisfies PasswordChangeRequest),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USER_QUERY_KEY });
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setCurrentPasswordError(null);
      toast.success("Password changed");
    },
    onError: (error: Error) => {
      if (settingsErrorDetail(error)?.code === "CURRENT_PASSWORD_INVALID") {
        setCurrentPasswordError("Current password is invalid.");
        return;
      }

      toast.error("Password was not changed", {
        description: "Please try again later.",
      });
    },
  });

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

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="current-password">Current Password</Label>
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-3">
          <PasswordInput
            id="current-password"
            value={currentPassword}
            onChange={(next) => {
              setCurrentPassword(next);
              setCurrentPasswordError(null);
            }}
            disabled={changePasswordMutation.isPending}
            visible={showCurrentPassword}
            onVisibleChange={setShowCurrentPassword}
          />
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
          <PasswordInput
            id="new-password"
            value={newPassword}
            onChange={setNewPassword}
            disabled={changePasswordMutation.isPending}
            visible={showNewPassword}
            onVisibleChange={setShowNewPassword}
          />
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
            {repeatPassword.length > 0 && (
              <div className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-center">
                {canChangePassword ? (
                  <CircleCheck className="h-4 w-4 text-green-500" />
                ) : (
                  <CircleX className="h-4 w-4 text-red-500" />
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-end">
            <button
              type="button"
              className={ACCOUNT_ACTION_BUTTON_CLASS}
              onClick={handleChangePassword}
              disabled={
                !canAttemptPasswordChange || changePasswordMutation.isPending
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
    </>
  );
}

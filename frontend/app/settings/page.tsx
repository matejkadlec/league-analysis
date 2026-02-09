"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ApiError,
  api,
  validatedGet,
  validatedPatch,
  validatedPost,
  validatedPut,
} from "@/lib/core/api";
import {
  EmailChangeCodeResponseSchema,
  MessageResponseSchema,
  SettingSchema,
  SettingTestResponseSchema,
  UserResponseSchema,
  UserSettingsSchema,
} from "@/lib/core/schemas";
import type { UserProfileUpdate, UserSettingsUpdate } from "@/lib/core/schemas";
import { ProtectedRoute, useAuth } from "@/features/auth";
import { ConnectRiotAccountDialog } from "@/features/profile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/core/utils";
import { toast } from "sonner";
import { notifyApiKeyValid } from "@/lib/core/api-key-status-context";
import {
  Check,
  CircleCheck,
  CircleX,
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  RefreshCcw,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  StopCircle,
  UserCog,
  X,
} from "lucide-react";

// Server to flag mapping (same as player-search.tsx)
const SERVER_FLAGS: Record<string, string> = {
  euw1: "🇪🇺",
  eun1: "🇪🇺",
  na1: "🇺🇸",
  kr: "🇰🇷",
  tr1: "🇹🇷",
  br1: "🇧🇷",
  la1: "🇲🇽",
  la2: "🇦🇷",
  oc1: "🇦🇺",
  ru: "🇷🇺",
  jp1: "🇯🇵",
  tw2: "🇹🇼",
  vn2: "🇻🇳",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_CODE_LENGTH = 6;
const PASSWORD_REQUIREMENTS_TEXT =
  "Password must be at least 8 characters long and include at least one uppercase letter, lowercase letter, number, and special character.";
const ACCOUNT_ACTION_BUTTON_CLASS =
  "button-medium no-rotation !h-9 !px-3 !py-2 w-36 justify-center";

interface APIKeyStatus {
  has_db_key: boolean;
  has_env_key: boolean;
  active_source: "db" | "env" | "none";
  env_key_identifier?: string;
}

interface BackendErrorDetail {
  code?: string;
  message?: string;
  locked_until?: string;
  attempts_remaining?: number;
}

interface MutationError extends Error {
  code?: string;
  lockedUntil?: string;
  attemptsRemaining?: number;
  status?: number;
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

export default function SettingsPage() {
  return (
    <ProtectedRoute>
      <SettingsPageContent />
    </ProtectedRoute>
  );
}

function SettingsPageContent() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [apiKey, setApiKey] = useState("");
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const queryClient = useQueryClient();

  // Fetch current API key
  const { data: settingResult, isLoading } = useQuery({
    queryKey: ["settings", "riot_api_key"],
    queryFn: () => validatedGet(SettingSchema, "/settings/riot_api_key"),
    enabled: isAdmin,
  });

  const setting = settingResult?.success ? settingResult.data : null;

  const { data: keyStatus, isLoading: isApiKeyStatusLoading } = useQuery({
    queryKey: ["apiKeyStatus"],
    queryFn: async () => {
      const response = await api.get<APIKeyStatus>(
        "/settings/riot_api_key/status",
      );
      return response.data;
    },
    enabled: isAdmin,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Update API key mutation
  const updateMutation = useMutation({
    mutationFn: (value: string) =>
      validatedPut(SettingSchema, "/settings/riot_api_key", { value }),
    onSuccess: (result) => {
      if (result.success) {
        toast.success("API key updated successfully!", {
          description: "Changes take effect immediately - no restart needed!",
        });
        queryClient.invalidateQueries({
          queryKey: ["settings", "riot_api_key"],
        });
        notifyApiKeyValid();
        queryClient.invalidateQueries({
          queryKey: ["apiKeyStatus"],
        });
        setApiKey("");
        setTestResult(null);
      } else {
        toast.error("Failed to update API key", {
          description: result.error.message,
        });
      }
    },
    onError: (error: Error) => {
      toast.error("Failed to update API key", {
        description: error.message || "An unexpected error occurred",
      });
    },
  });

  // Test API key mutation
  const testMutation = useMutation({
    mutationFn: (value: string) =>
      validatedPost(SettingTestResponseSchema, "/settings/riot_api_key/test", {
        value,
      }),
    onSuccess: (result) => {
      if (result.success) {
        setTestResult({
          success: result.data.success,
          message: result.data.message,
        });
        if (result.data.success) {
          toast.success("API key is valid!", {
            description: result.data.message,
          });
        } else {
          toast.error("API key is invalid", {
            description: result.data.message,
          });
        }
      }
    },
    onError: (error: Error) => {
      toast.error("Failed to test API key", {
        description: error.message || "An unexpected error occurred",
      });
    },
  });

  const handleTestKey = () => {
    if (!apiKey.trim()) {
      toast.error("Please enter an API key");
      return;
    }
    setTestingKey(true);
    testMutation.mutate(apiKey, {
      onSettled: () => setTestingKey(false),
    });
  };

  const handleSaveKey = () => {
    if (!apiKey.trim()) {
      toast.error("Please enter an API key");
      return;
    }

    if (!apiKey.startsWith("RGAPI-")) {
      toast.error("Invalid API key format", {
        description: "Riot API keys must start with 'RGAPI-'",
      });
      return;
    }

    updateMutation.mutate(apiKey);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 space-y-6">
        <Card
          id="header-card"
          className="bg-[#152b56] p-6 text-white dark:bg-[#0a1428]"
        >
          <div className="mb-4 flex items-start justify-between">
            <h1 className="text-2xl font-semibold">Settings</h1>
          </div>
          <p className="text-sm leading-relaxed">
            {isAdmin
              ? "Configure application settings, account security, and global Riot API configuration"
              : "Configure application settings and account security"}
          </p>
        </Card>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <UserSettingsCard className="lg:col-span-1" />

          {isAdmin && (
            <Card className="h-full p-6 lg:col-span-2">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
                <ShieldCheck className="h-5 w-5 text-[#cfa93a]" />
                Riot API Configuration
              </h2>

              {isLoading || isApiKeyStatusLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4 text-left">
                  {setting && (
                    <div className="space-y-1.5">
                      <Label>Current API Key</Label>
                      <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono">
                        {setting.masked_value}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Last updated:{" "}
                        {new Date(setting.updated_at).toLocaleString()}
                      </p>
                    </div>
                  )}

                  {!setting && keyStatus?.active_source === "none" && (
                    <Alert className="border-red-700 bg-red-950/40 text-red-200">
                      <p className="text-sm">
                        No active Riot API Key found. System cannot function.
                        Please configure it in settings
                        {process.env.NODE_ENV === "production"
                          ? ""
                          : " or .env"}
                        .
                      </p>
                    </Alert>
                  )}

                  {!setting && keyStatus?.active_source === "env" && (
                    <Alert className="border-amber-700 bg-amber-950/40 text-amber-200">
                      <p className="text-sm">
                        Using Riot API Key from environment variables. Consider
                        adding it to database for better management.
                      </p>
                    </Alert>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="api-key">New Riot API Key</Label>
                    <Input
                      id="api-key"
                      type="text"
                      placeholder="RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      value={apiKey}
                      onChange={(event) => {
                        setApiKey(event.target.value);
                        setTestResult(null);
                      }}
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Get your API key from{" "}
                      <a
                        href="https://developer.riotgames.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        developer.riotgames.com
                      </a>
                    </p>
                  </div>

                  {testResult && (
                    <Alert
                      className={
                        testResult.success
                          ? "border-green-500/50 bg-green-500/10"
                          : "border-red-500/50 bg-red-500/10"
                      }
                    >
                      <div className="flex items-start gap-2">
                        {testResult.success ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <X className="h-4 w-4 text-red-500" />
                        )}
                        <div>
                          <p className="text-sm font-medium">
                            {testResult.message}
                          </p>
                        </div>
                      </div>
                    </Alert>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={handleTestKey}
                      variant="outline"
                      disabled={
                        !apiKey.trim() || testingKey || testMutation.isPending
                      }
                    >
                      {testingKey || testMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <FlaskConical className="h-4 w-4" />
                          Test Key
                        </>
                      )}
                    </Button>

                    <Button
                      onClick={handleSaveKey}
                      disabled={
                        !apiKey.trim() ||
                        updateMutation.isPending ||
                        (testResult !== null && !testResult.success)
                      }
                    >
                      {updateMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          Save & Apply
                        </>
                      )}
                    </Button>
                  </div>

                  <Alert>
                    <p className="text-sm">
                      <strong>Note:</strong> The API key will be validated
                      before saving. Newly generated keys usually{" "}
                      <b>need a minute or two</b> before they start working.
                      Development keys (starting with RGAPI-) expire every 24
                      hours and need to be renewed.
                    </p>
                  </Alert>
                </div>
              )}
            </Card>
          )}

          <AccountSettingsCard className="lg:col-span-1" />
        </div>
      </div>
    </div>
  );
}

interface UserSettingsCardProps {
  className?: string;
}

function UserSettingsCard({
  className = "lg:col-span-1",
}: UserSettingsCardProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const checkboxCooldownRef = useRef(0);

  const { data: userSettingsResult, isLoading } = useQuery({
    queryKey: ["user-settings", userId],
    queryFn: () => validatedGet(UserSettingsSchema, "/settings/user"),
    enabled: !!userId,
  });

  const userSettings = userSettingsResult?.success
    ? userSettingsResult.data
    : null;

  const updateMutation = useMutation({
    mutationFn: async (update: UserSettingsUpdate) => {
      const result = await validatedPut(
        UserSettingsSchema,
        "/settings/user",
        update,
      );
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-settings", userId] });
      toast.success("Settings saved", {
        duration: 1000,
      });
    },
    onError: (error: Error) => {
      toast.error("Failed to save settings", {
        description: error.message,
      });
    },
  });

  const handleToggle = (
    field: keyof UserSettingsUpdate,
    value: boolean,
    timestamp: number,
  ) => {
    const now = timestamp;
    if (now < checkboxCooldownRef.current) {
      toast.error("You need to wait a few seconds to repeat this action");
      return;
    }

    checkboxCooldownRef.current = now + 2000;
    updateMutation.mutate({ [field]: value });
  };

  return (
    <Card className={cn("h-full p-6 text-left", className)}>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
        <Settings2 className="h-5 w-5 text-[#cfa93a]" />
        Application Settings
      </h2>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Theme</Label>
            <p className="text-xs text-muted-foreground">
              Theme selection coming soon
            </p>
            <Select
              value={userSettings?.theme || "DARK"}
              disabled
              onValueChange={(value) =>
                updateMutation.mutate({ theme: value as "LIGHT" | "DARK" })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DARK">Dark</SelectItem>
                <SelectItem value="LIGHT">Light</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Default Server</Label>
            <p className="text-xs text-muted-foreground">
              Default server coming soon
            </p>
            <Select
              value={userSettings?.default_platform || "eun1"}
              disabled
              onValueChange={(value) =>
                updateMutation.mutate({ default_platform: value })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select server" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="euw1">
                  <span className="flex items-center space-x-2">
                    <span>{SERVER_FLAGS.euw1}</span>
                    <span>EUW</span>
                  </span>
                </SelectItem>
                <SelectItem value="eun1">
                  <span className="flex items-center space-x-2">
                    <span>{SERVER_FLAGS.eun1}</span>
                    <span>EUNE</span>
                  </span>
                </SelectItem>
                <SelectItem value="na1">
                  <span className="flex items-center space-x-2">
                    <span>{SERVER_FLAGS.na1}</span>
                    <span>NA</span>
                  </span>
                </SelectItem>
                <SelectItem value="kr">
                  <span className="flex items-center space-x-2">
                    <span>{SERVER_FLAGS.kr}</span>
                    <span>KR</span>
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label>Save Playstyle Analysis Search</Label>
                <p className="text-xs text-muted-foreground">
                  Saves searched player in Playstyle Analysis
                </p>
              </div>
              <input
                type="checkbox"
                checked={userSettings?.save_playstyle_url || false}
                onChange={(event) =>
                  handleToggle(
                    "save_playstyle_url",
                    event.target.checked,
                    event.timeStamp,
                  )
                }
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                disabled={updateMutation.isPending}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <Label>Save Matchmaking Analysis Search</Label>
                <p className="text-xs text-muted-foreground">
                  Saves searched player in Matchmaking Analysis
                </p>
              </div>
              <input
                type="checkbox"
                checked={userSettings?.save_matchmaking_url || false}
                onChange={(event) =>
                  handleToggle(
                    "save_matchmaking_url",
                    event.target.checked,
                    event.timeStamp,
                  )
                }
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                disabled={updateMutation.isPending}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <Label>Save Viewed Tracked Player</Label>
                <p className="text-xs text-muted-foreground">
                  Saves viewed player in Tracked Players
                </p>
              </div>
              <input
                type="checkbox"
                checked={userSettings?.save_tracked_url || false}
                onChange={(event) =>
                  handleToggle(
                    "save_tracked_url",
                    event.target.checked,
                    event.timeStamp,
                  )
                }
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                disabled={updateMutation.isPending}
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

interface AccountSettingsCardProps {
  className?: string;
}

function AccountSettingsCard({
  className = "lg:col-span-1",
}: AccountSettingsCardProps) {
  const queryClient = useQueryClient();
  const { user, checkAuth } = useAuth();

  const [draftDisplayName, setDraftDisplayName] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);

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
    isPasswordStrongEnough && passwordsMatch && repeatPassword.length > 0;

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
    onError: (error: Error) => {
      toast.error("Failed to update display name", {
        description: error.message,
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
      toast.success("Verification code sent", {
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

      toast.error("Failed to send verification code", {
        description: mutationError.message,
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
      toast.success("Email updated successfully.");
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

      toast.error("Failed to verify code", {
        description: mutationError.message,
      });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      const result = await validatedPost(
        MessageResponseSchema,
        "/auth/change-password",
        {
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
      setNewPassword("");
      setRepeatPassword("");
      setShowNewPassword(false);
      toast.success("Password changed successfully.");
    },
    onError: (error: Error) => {
      toast.error("Failed to change password", {
        description: error.message,
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
      toast.error("Display name cannot be empty");
      return;
    }

    if (trimmed.length < 3) {
      toast.error("Display name too short", {
        description: "Must be at least 3 characters",
      });
      return;
    }

    const validPattern = /^[\p{L}](?:[\p{L}\p{M}_ ]*[\p{L}])?$/u;
    if (!validPattern.test(trimmed)) {
      toast.error("Invalid display name", {
        description:
          "Must only contain letters, underscores, and spaces. Cannot start or end with space or underscore.",
      });
      return;
    }

    if (!/^[\p{L}\p{M}_ ]+$/u.test(trimmed)) {
      toast.error("Invalid characters", {
        description:
          "Only letters, underscores, and spaces are allowed in display name",
      });
      return;
    }

    updateDisplayNameMutation.mutate({ display_name: trimmed });
  };

  const handleRiotAccountUpdated = () => {
    void checkAuth();
    queryClient.invalidateQueries({ queryKey: ["player"] });
    queryClient.invalidateQueries({ queryKey: ["champion-stats"] });
    queryClient.invalidateQueries({ queryKey: ["lane-stats"] });
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
    if (!canChangePassword || changePasswordMutation.isPending) {
      return;
    }

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

            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-end gap-3">
              <div className="space-y-1.5">
                <Label>Connected Riot Account</Label>
                <p className="text-xs text-muted-foreground">
                  {user?.riot_account_connected
                    ? "Update your connected account for My Profile"
                    : "Connect an account to view your profile"}
                </p>
              </div>
              <div className="flex items-center justify-end">
                <ConnectRiotAccountDialog
                  trigger={
                    <Button className={ACCOUNT_ACTION_BUTTON_CLASS}>
                      <Link2 className="h-4 w-4" />
                      {user?.riot_account_connected ? "Update" : "Connect"}
                    </Button>
                  }
                  onSuccess={handleRiotAccountUpdated}
                />
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
                      !canChangePassword || changePasswordMutation.isPending
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
          </div>
        </TooltipProvider>
      </Card>

      <Dialog open={emailDialogOpen} onOpenChange={handleEmailDialogOpenChange}>
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

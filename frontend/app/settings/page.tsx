"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  validatedGet,
  validatedPut,
  validatedPost,
  validatedPatch,
} from "@/lib/core/api";
import {
  SettingSchema,
  SettingTestResponseSchema,
  UserSettingsSchema,
  UserSettingsUpdate,
  UserResponseSchema,
  UserProfileUpdate,
} from "@/lib/core/schemas";
import { ProtectedRoute, useAuth } from "@/features/auth";
import { ConnectRiotAccountDialog } from "@/features/profile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Loader2,
  Check,
  X,
  Link2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { notifyApiKeyValid } from "@/lib/core/api-key-status-context";

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

interface APIKeyStatus {
  has_db_key: boolean;
  has_env_key: boolean;
  active_source: "db" | "env" | "none";
  env_key_identifier?: string;
}

export default function SettingsPage() {
  return (
    <ProtectedRoute requireAdmin>
      <SettingsPageContent />
    </ProtectedRoute>
  );
}

function SettingsPageContent() {
  const [apiKey, setApiKey] = useState("");
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const queryClient = useQueryClient();

  // Fetch current API key
  const {
    data: settingResult,
    isLoading,
  } = useQuery({
    queryKey: ["settings", "riot_api_key"],
    queryFn: () => validatedGet(SettingSchema, "/settings/riot_api_key"),
  });

  const setting = settingResult?.success ? settingResult.data : null;

  const { data: keyStatus, isLoading: isApiKeyStatusLoading } = useQuery({
    queryKey: ["apiKeyStatus"],
    queryFn: async () => {
      const response = await api.get<APIKeyStatus>("/settings/riot_api_key/status");
      return response.data;
    },
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
        // Clear the "API key invalid" header message since we now have a new key
        notifyApiKeyValid();
        queryClient.invalidateQueries({
          queryKey: ["apiKeyStatus"],
        });
        setApiKey(""); // Clear input
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
          // Note: Don't clear the header message here since the key hasn't been saved yet
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

    // Validate format
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
        {/* Header */}
        <Card
          id="header-card"
          className="bg-[#152b56] p-6 text-white dark:bg-[#0a1428]"
        >
          <div className="mb-4 flex items-start justify-between">
            <h1 className="text-2xl font-semibold">Settings</h1>
          </div>
          <p className="text-sm leading-relaxed">
            Configure your user settings as well as global system settings
          </p>
        </Card>

        {/* Two-column grid for settings cards */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
          {/* User Settings - Left Column (40% width) */}
          <UserSettingsCard />

          {/* Riot API Configuration - Right Column (60% width) */}
          <Card className="p-6 lg:col-span-3">
            <h2 className="mb-4 text-lg font-semibold">
              Riot API Configuration
            </h2>

            {isLoading || isApiKeyStatusLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Current API Key Display */}
                {setting && (
                  <div>
                    <Label>Current API Key</Label>
                    <div className="mt-1.5 rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono">
                      {setting.masked_value}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last updated:{" "}
                      {new Date(setting.updated_at).toLocaleString()}
                    </p>
                  </div>
                )}

                {!setting && keyStatus?.active_source === "none" && (
                  <Alert className="border-red-700 bg-red-950/40 text-red-200">
                    <p className="text-sm">
                      No active Riot API Key found! System cannot function.
                      Please configure it in settings
                      {process.env.NODE_ENV === "production" ? " " : " or .env "}
                      immediately.
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

                {/* New API Key Input */}
                <div>
                  <Label htmlFor="api-key">New Riot API Key</Label>
                  <Input
                    id="api-key"
                    type="text"
                    placeholder="RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setTestResult(null);
                    }}
                    className="mt-1.5 font-mono text-sm"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
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

                {/* Test Result */}
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

                {/* Action Buttons */}
                <div className="flex gap-2">
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
                      "Test Key"
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
                      "Save & Apply"
                    )}
                  </Button>
                </div>

                {/* Info Note */}
                <Alert>
                  <p className="text-sm">
                    <strong>Note:</strong> The API key will be validated before
                    saving. Newly generated keys usually{" "}
                    <b>need a minute or two </b>
                    before they start working. Development keys (starting with
                    RGAPI-) expire every 24 hours and need to be renewed.
                  </p>
                </Alert>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// User Settings Card Component
function UserSettingsCard() {
  const queryClient = useQueryClient();
  const { user, checkAuth } = useAuth();
  const userId = user?.id;
  const checkboxCooldownRef = useRef(0);
  const [draftDisplayName, setDraftDisplayName] = useState<string | null>(null);
  const currentDisplayName = user?.display_name ?? "";
  const displayName = draftDisplayName ?? currentDisplayName;
  const displayNameDirty =
    draftDisplayName !== null && draftDisplayName !== currentDisplayName;

  // Fetch user settings
  const { data: userSettingsResult, isLoading } = useQuery({
    queryKey: ["user-settings", userId],
    queryFn: () => validatedGet(UserSettingsSchema, "/settings/user"),
    enabled: !!userId,
  });

  const userSettings = userSettingsResult?.success
    ? userSettingsResult.data
    : null;

  // Update user settings mutation
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

  // Update display name mutation
  const updateDisplayNameMutation = useMutation({
    mutationFn: async (update: UserProfileUpdate) => {
      const result = await validatedPatch(
        UserResponseSchema,
        "/auth/me",
        update,
      );
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: () => {
      checkAuth(); // Refresh user data
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

  const handleDisplayNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextDisplayName = e.target.value;
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

    // Allow letters from any language, underscores, and spaces.
    const validPattern = /^[\p{L}](?:[\p{L}\p{M}_ ]*[\p{L}])?$/u;
    if (!validPattern.test(trimmed)) {
      toast.error("Invalid display name", {
        description:
          "Must only contain letters (including language-specific characters), underscores, and spaces. Cannot start or end with space or underscore.",
      });
      return;
    }

    // Additional check for invalid characters
    if (!/^[\p{L}\p{M}_ ]+$/u.test(trimmed)) {
      toast.error("Invalid characters", {
        description:
          "Only letters (including language-specific characters), underscores, and spaces are allowed",
      });
      return;
    }

    updateDisplayNameMutation.mutate({ display_name: trimmed });
  };

  // Handler for riot account update success
  const handleRiotAccountUpdated = () => {
    checkAuth(); // Refresh user data to get new puuid
    queryClient.invalidateQueries({ queryKey: ["player"] });
    queryClient.invalidateQueries({ queryKey: ["champion-stats"] });
    queryClient.invalidateQueries({ queryKey: ["lane-stats"] });
  };

  return (
    <Card className="p-6 lg:col-span-2 h-full">
      <h2 className="mb-4 text-lg font-semibold">User Settings</h2>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {/* Display Name Setting */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <Label>Display Name</Label>
              <p className="text-xs text-muted-foreground">
                Name shown across the website
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={displayName}
                onChange={handleDisplayNameChange}
                className="w-40"
                maxLength={128}
                disabled={updateDisplayNameMutation.isPending}
              />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant={displayNameDirty ? "default" : "outline"}
                      className="h-9 w-9 button-small no-rotation cursor-pointer"
                      onClick={handleSaveDisplayName}
                      disabled={
                        !displayNameDirty || updateDisplayNameMutation.isPending
                      }
                    >
                      {updateDisplayNameMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-5 w-5" strokeWidth={3} />
                      )}
                    </Button>
                  </TooltipTrigger>
                  {displayNameDirty && (
                    <TooltipContent>
                      <p>Save changes</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Connected Riot Account Setting */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <Label>Connected Riot Account</Label>
              <p className="text-xs text-muted-foreground">
                {user?.riot_account_connected
                  ? "Update your connected account for My Profile"
                  : "Connect an account to view your profile"}
              </p>
            </div>
            <ConnectRiotAccountDialog
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2 button-small opacity-90 w-50"
                >
                  <Link2 className="h-4 w-4" />
                  {user?.riot_account_connected ? "Update" : "Connect"}
                </Button>
              }
              onSuccess={handleRiotAccountUpdated}
            />
          </div>

          {/* Theme Selection - Disabled for now */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Theme</Label>
              <p className="text-xs text-muted-foreground">
                Theme selection coming soon
              </p>
            </div>
            <Select
              value={userSettings?.theme || "DARK"}
              disabled
              onValueChange={(value) =>
                updateMutation.mutate({ theme: value as "LIGHT" | "DARK" })
              }
            >
              <SelectTrigger className="w-50">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DARK">Dark</SelectItem>
                <SelectItem value="LIGHT">Light</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Default Server - Disabled for now */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Default Server</Label>
              <p className="text-xs text-muted-foreground">
                Default server coming soon
              </p>
            </div>
            <Select
              value={userSettings?.default_platform || "eun1"}
              disabled
              onValueChange={(value) =>
                updateMutation.mutate({ default_platform: value })
              }
            >
              <SelectTrigger className="w-50">
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

          {/* URL Save Toggles - 3/4 column layout for tighter checkbox alignment */}
          <div className="grid grid-cols-4 gap-x-4 gap-y-3">
            {/* Save Playstyle URL Toggle */}
            <div className="col-span-3">
              <Label>Save Playstyle Analysis Search</Label>
              <p className="text-xs text-muted-foreground">
                Saves searched player in Playstyle Analysis
              </p>
            </div>
            <div className="flex items-center justify-end">
              <input
                type="checkbox"
                checked={userSettings?.save_playstyle_url || false}
                onChange={(e) =>
                  handleToggle(
                    "save_playstyle_url",
                    e.target.checked,
                    e.timeStamp,
                  )
                }
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                disabled={updateMutation.isPending}
              />
            </div>

            {/* Save Matchmaking URL Toggle */}
            <div className="col-span-3">
              <Label>Save Matchmaking Analysis Search</Label>
              <p className="text-xs text-muted-foreground">
                Saves searched player in Matchmaking Analysis
              </p>
            </div>
            <div className="flex items-center justify-end">
              <input
                type="checkbox"
                checked={userSettings?.save_matchmaking_url || false}
                onChange={(e) =>
                  handleToggle(
                    "save_matchmaking_url",
                    e.target.checked,
                    e.timeStamp,
                  )
                }
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                disabled={updateMutation.isPending}
              />
            </div>

            {/* Save Tracked Players URL Toggle */}
            <div className="col-span-3">
              <Label>Save Viewed Tracked Player</Label>
              <p className="text-xs text-muted-foreground">
                Saves viewed player in Tracked Players
              </p>
            </div>
            <div className="flex items-center justify-end">
              <input
                type="checkbox"
                checked={userSettings?.save_tracked_url || false}
                onChange={(e) =>
                  handleToggle(
                    "save_tracked_url",
                    e.target.checked,
                    e.timeStamp,
                  )
                }
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                disabled={updateMutation.isPending}
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

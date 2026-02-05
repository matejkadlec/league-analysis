"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  validatedGet,
  validatedPut,
  validatedPost,
  validatedPatch,
} from "@/lib/core/api";
import {
  SettingSchema,
  SettingTestResponseSchema,
  UserSettingsSchema,
  UserSettings,
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
  Save,
  Link2,
  CheckIcon,
  CheckCheckIcon,
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
    error,
  } = useQuery({
    queryKey: ["settings", "riot_api_key"],
    queryFn: () => validatedGet(SettingSchema, "/settings/riot_api_key"),
  });

  const setting = settingResult?.success ? settingResult.data : null;

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
            <h1 className="text-2xl font-semibold">System Settings</h1>
          </div>
          <p className="text-sm leading-relaxed">
            Configure system settings and runtime configuration
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

            {isLoading ? (
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

                {!setting && !error && (
                  <Alert>
                    <p className="text-sm">
                      No API key configured in database. Using environment
                      variable.
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
  const [displayName, setDisplayName] = useState("");
  const [displayNameDirty, setDisplayNameDirty] = useState(false);

  // Initialize display name from user
  useEffect(() => {
    if (user?.display_name && !displayNameDirty) {
      setDisplayName(user.display_name);
    }
  }, [user?.display_name, displayNameDirty]);

  // Fetch user settings
  const { data: userSettingsResult, isLoading } = useQuery({
    queryKey: ["user-settings"],
    queryFn: () => validatedGet(UserSettingsSchema, "/settings/user"),
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
      queryClient.invalidateQueries({ queryKey: ["user-settings"] });
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
      setDisplayNameDirty(false);
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

  const handleToggle = (field: keyof UserSettingsUpdate, value: boolean) => {
    updateMutation.mutate({ [field]: value });
  };

  const handleDisplayNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDisplayName(e.target.value);
    setDisplayNameDirty(e.target.value !== user?.display_name);
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

    // Only allow letters, underscores, and spaces
    const validPattern = /^[A-Za-z][A-Za-z_ ]*[A-Za-z]$|^[A-Za-z]{1,2}$/;
    if (!validPattern.test(trimmed)) {
      toast.error("Invalid display name", {
        description:
          "Must only contain letters (A-Z), underscores, and spaces. Cannot start or end with space or underscore.",
      });
      return;
    }

    // Additional check for invalid characters
    if (!/^[A-Za-z_ ]+$/.test(trimmed)) {
      toast.error("Invalid characters", {
        description: "Only letters (A-Z), underscores, and spaces are allowed",
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
        <div className="space-y-4">
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
          <div className="grid grid-cols-4 gap-x-4 gap-y-3 pt-2">
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
                  handleToggle("save_playstyle_url", e.target.checked)
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
                  handleToggle("save_matchmaking_url", e.target.checked)
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

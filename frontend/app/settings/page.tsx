"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { validatedGet, validatedPut, validatedPost } from "@/lib/core/api";
import {
  SettingSchema,
  SettingTestResponseSchema,
  UserSettingsSchema,
  UserSettings,
  UserSettingsUpdate,
} from "@/lib/core/schemas";
import { ProtectedRoute } from "@/features/auth";
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

import { Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";

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
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          {/* User Settings - Left Column */}
          <UserSettingsCard />

          {/* Riot API Configuration - Right Column */}
          <Card className="p-6 lg:col-span-2">
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
                    saving. Development keys (starting with RGAPI-) expire every
                    24 hours and need to be renewed.
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

  const handleToggle = (field: keyof UserSettingsUpdate, value: boolean) => {
    updateMutation.mutate({ [field]: value });
  };

  return (
    <Card className="p-6">
      <h2 className="mb-4 text-lg font-semibold">User Settings</h2>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
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
              <SelectTrigger className="w-32">
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
              <SelectTrigger className="w-32">
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

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiErrorMessage,
  api,
  validatedGet,
  validatedPost,
  validatedPut,
} from "@/lib/core/api";
import {
  SettingSchema,
  SettingTestResponseSchema,
} from "@/lib/core/schemas";
import { ProtectedRoute, useAuth } from "@/features/auth";
import { AccountSettingsCard } from "@/features/settings/components/account-settings-card";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { useToast } from "@/lib/core/hooks";
import { notifyRiotCredentialHealthUpdated } from "@/lib/core/riot-credential-health-events";
import {
  Check,
  FlaskConical,
  Loader2,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";

interface APIKeyStatus {
  has_db_key: boolean;
  has_env_key: boolean;
  active_source: "db" | "env" | "none";
  credential_status: "missing" | "unknown" | "valid" | "invalid";
  evidence:
    | "missing"
    | "configured"
    | "settings_validation"
    | "provider_success"
    | "credential_rejected";
  observed_at: string;
  health_revision: number;
}

export default function SettingsPage() {
  return (
    <ProtectedRoute>
      <SettingsPageContent />
    </ProtectedRoute>
  );
}

function SettingsPageContent() {
  const toast = useToast();
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
        toast.success("Riot API key updated", {
          description: "The new key is active; no server restart is required.",
        });
        void queryClient.invalidateQueries({
          queryKey: ["settings", "riot_api_key"],
        });
        notifyRiotCredentialHealthUpdated();
        void queryClient.invalidateQueries({
          queryKey: ["apiKeyStatus"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["service-status"],
        });
        setApiKey("");
        setTestResult(null);
      } else {
        toast.error("Riot API key was not updated", {
          description: apiErrorMessage(
            result.error,
            "The key could not be saved. Please try again later.",
          ),
        });
      }
    },
    onError: () => {
      toast.error("Riot API key was not updated", {
        description: "The key could not be saved. Please try again later.",
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
        if (result.data.status === "valid") {
          toast.success("Riot API key is valid", {
            description: "Riot accepted the key.",
          });
        } else if (result.data.status === "unavailable") {
          toast.warning("Riot API key could not be verified", {
            description: "Riot could not be reached. Try again later.",
          });
        } else {
          toast.error("Riot API key is invalid", {
            description: "Check the key and try again.",
          });
        }
      } else {
        toast.error("Riot API key could not be tested", {
          description: apiErrorMessage(
            result.error,
            "The key could not be tested. Please try again later.",
          ),
        });
      }
    },
    onError: () => {
      toast.error("Riot API key could not be tested", {
        description: "The key could not be tested. Please try again later.",
      });
    },
  });

  const handleTestKey = () => {
    if (!apiKey.trim()) {
      toast.warning("Enter a Riot API key");
      return;
    }
    setTestingKey(true);
    testMutation.mutate(apiKey, {
      onSettled: () => setTestingKey(false),
    });
  };

  const handleSaveKey = () => {
    if (!apiKey.trim()) {
      toast.warning("Enter a Riot API key");
      return;
    }

    if (!apiKey.startsWith("RGAPI-")) {
      toast.warning("Check the Riot API key format", {
        description: "Riot API keys must start with 'RGAPI-'.",
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
              ? "Manage account security and global Riot API configuration"
              : "Manage your account profile and security"}
          </p>
        </Card>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
          <AccountSettingsCard
            className={isAdmin ? "lg:col-span-2" : "lg:col-span-5"}
          />

          {isAdmin && (
            <Card className="h-full p-6 lg:col-span-3">
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
                        No active Riot API Key found, insert a valid key into
                        the field below to restore functionality.
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
        </div>
      </div>
    </div>
  );
}


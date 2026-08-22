"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Loader2,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCardPreferences,
  getSmurfBoostPresets,
  resetCardPreference,
  updateCardPreference,
} from "../smurf-boost-api";
import { unwrap } from "@/lib/core/api";
import { apiErrorMessage } from "@/lib/core/api-error";
import { useToast } from "@/lib/core/hooks";
import type { CardPreference, SmurfBoostPreset } from "@/lib/core/schemas";

import {
  crossFieldError,
  fieldError,
  numericSettings,
  SMURF_BOOST_CARD_ID,
  THRESHOLD_FIELDS,
} from "../smurf-boost-settings";
import { SmurfBoostSettingsPresets } from "./smurf-boost-settings-presets";
import { SmurfBoostSettingsThresholds } from "./smurf-boost-settings-thresholds";

const PREFERENCE_KEY = ["card-preferences"] as const;
const PRESETS_KEY = ["smurf-boost-presets"] as const;

function SettingsSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}

export function SmurfBoostSettingsCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const presetsQuery = useQuery({
    queryKey: PRESETS_KEY,
    queryFn: async () => {
      return unwrap(await getSmurfBoostPresets());
    },
    staleTime: 3600000,
    retry: false,
  });

  const preferenceQuery = useQuery({
    queryKey: PREFERENCE_KEY,
    queryFn: async () => {
      return unwrap(await getCardPreferences());
    },
    retry: false,
  });

  const preference: CardPreference | null =
    preferenceQuery.data?.find(
      (entry) => entry.cardId === SMURF_BOOST_CARD_ID,
    ) ?? null;

  const store = (updated: CardPreference) => {
    queryClient.setQueryData(
      PREFERENCE_KEY,
      (current: CardPreference[] | undefined) =>
        (current ?? []).map((entry) =>
          entry.cardId === updated.cardId ? updated : entry,
        ),
    );
    setDraft(null);
    setFailure(null);
  };

  const saveMutation = useMutation({
    mutationFn: async (settings: Record<string, number>) => {
      const result = await updateCardPreference(SMURF_BOOST_CARD_ID, settings);
      if (!result.success) {
        throw new Error(
          apiErrorMessage(
            result.error,
            "Those settings were rejected. Check the allowed range under each field.",
          ),
        );
      }
      return result.data;
    },
    onMutate: () => setFailure(null),
    onSuccess: (updated) => {
      store(updated);
      toast.success("Settings saved", {
        description: "The next comparison uses these thresholds.",
      });
    },
    onError: (error: Error) => {
      setFailure(error.message);
      toast.error("Settings not saved", { description: error.message });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const result = await resetCardPreference(SMURF_BOOST_CARD_ID);
      if (!result.success) {
        throw new Error(
          apiErrorMessage(result.error, "The settings could not be reset."),
        );
      }
      return result.data;
    },
    onMutate: () => setFailure(null),
    onSuccess: (updated) => {
      store(updated);
      toast.success("Settings reset", {
        description: "The shipped defaults are back in use.",
      });
    },
    onError: (error: Error) => {
      setFailure(error.message);
      toast.error("Settings not reset", { description: error.message });
    },
  });

  if (preferenceQuery.isLoading) {
    return <SettingsSkeleton />;
  }

  if (!preference) {
    return (
      <Card id="smurf-boost-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-primary" />
            Detection Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your settings could not be loaded, so the comparison runs with the
              shipped defaults.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const effective = numericSettings(preference.settings);
  const values: Record<string, string> =
    draft ??
    Object.fromEntries(
      THRESHOLD_FIELDS.map((field) => [
        field.name,
        String(effective[field.name] ?? ""),
      ]),
    );

  const parsed: Record<string, number> = Object.fromEntries(
    THRESHOLD_FIELDS.map((field) => {
      const raw = values[field.name] ?? "";
      return [field.name, raw.trim() === "" ? Number.NaN : Number(raw)];
    }),
  );
  const errors: Record<string, string> = {};
  for (const field of THRESHOLD_FIELDS) {
    const message = fieldError(field, parsed[field.name] ?? Number.NaN);
    if (message) {
      errors[field.name] = message;
    }
  }
  const crossError = crossFieldError(parsed);
  const invalid = Object.keys(errors).length > 0 || crossError !== null;
  const changed = THRESHOLD_FIELDS.some(
    (field) => parsed[field.name] !== effective[field.name],
  );
  const dirty = draft !== null;
  const busy = saveMutation.isPending || resetMutation.isPending;

  const presets: SmurfBoostPreset[] = presetsQuery.data?.presets ?? [];

  return (
    <Card id="smurf-boost-settings">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-primary" />
            Detection Settings
          </CardTitle>
          <Badge variant="outline" className="ml-auto">
            {preference.isDefault ? "Shipped defaults" : "Your settings"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          These thresholds are yours alone and apply to every comparison you
          run. They change how easily an area is called unusual; they never
          change what the reading means.
        </p>

        {failure && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}

        <SmurfBoostSettingsPresets
          presets={presets}
          isError={presetsQuery.isError}
          busy={busy}
          effective={effective}
          onSelect={(settings) => saveMutation.mutate(settings)}
        />

        <SmurfBoostSettingsThresholds
          values={values}
          errors={errors}
          crossError={crossError}
          busy={busy}
          onChange={(name, value) => setDraft({ ...values, [name]: value })}
        />

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => saveMutation.mutate(parsed)}
            disabled={busy || invalid || !changed}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save thresholds
          </Button>
          <Button
            variant="outline"
            onClick={() => resetMutation.mutate()}
            disabled={busy || (preference.isDefault && !dirty)}
          >
            {resetMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            Reset to defaults
          </Button>
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setFailure(null);
              }}
              disabled={busy}
            >
              Discard changes
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

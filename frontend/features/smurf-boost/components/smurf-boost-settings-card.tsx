"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCardPreferences,
  getSmurfBoostPresets,
  resetCardPreference,
  updateCardPreference,
} from "@/lib/core/api";
import { apiErrorMessage } from "@/lib/core/api-error";
import { useToast } from "@/lib/core/hooks";
import type { CardPreference, SmurfBoostPreset } from "@/lib/core/schemas";

import {
  crossFieldError,
  fieldError,
  matchesPreset,
  numericSettings,
  presetDescription,
  presetLabel,
  SMURF_BOOST_CARD_ID,
  THRESHOLD_FIELDS,
  writableSettings,
} from "../smurf-boost-settings";

const PREFERENCE_KEY = ["card-preferences"] as const;

/** Both sides of the one cross-field rule, so both inputs can be marked. */
const CROSS_FIELD_NAMES = ["recentWindowSize", "a3MinimumNovelGames"];
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
      const result = await getSmurfBoostPresets();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    staleTime: 3600000,
    retry: false,
  });

  const preferenceQuery = useQuery({
    queryKey: PREFERENCE_KEY,
    queryFn: async () => {
      const result = await getCardPreferences();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
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
        // A rejected write is reported through the shared normalization,
        // which replaces a body carrying a class name or a schema URL with a
        // safe sentence. Every rule this form can break is already stated
        // beside the field, so nothing is lost by not repeating the server's.
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
            Detection settings
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

  // `Number("")` is 0, and one threshold legitimately allows 0, so a cleared
  // field would otherwise save as zero without ever looking wrong.
  const parsed: Record<string, number> = Object.fromEntries(
    THRESHOLD_FIELDS.map((field) => {
      const raw = values[field.name] ?? "";
      return [field.name, raw.trim() === "" ? Number.NaN : Number(raw)];
    }),
  );
  const errors: Record<string, string> = {};
  for (const field of THRESHOLD_FIELDS) {
    // `parsed` was built from the same field list, so the lookup always hits.
    const message = fieldError(field, parsed[field.name] ?? Number.NaN);
    if (message) {
      errors[field.name] = message;
    }
  }
  const crossError = crossFieldError(parsed);
  const invalid = Object.keys(errors).length > 0 || crossError !== null;
  // Editing a field back to its stored value is not a change. Saving it would
  // still write an override and turn "Shipped defaults" into "Your settings".
  const changed = THRESHOLD_FIELDS.some(
    (field) => parsed[field.name] !== effective[field.name],
  );
  const dirty = draft !== null;
  const busy = saveMutation.isPending || resetMutation.isPending;

  const presets: SmurfBoostPreset[] = presetsQuery.data?.presets ?? [];
  const activePreset = presets.find((preset) =>
    matchesPreset(effective, preset.thresholds),
  );

  return (
    <Card id="smurf-boost-settings">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-primary" />
          Detection settings
          <Badge variant="outline" className="ml-auto">
            {preference.isDefault ? "Shipped defaults" : "Your settings"}
          </Badge>
        </CardTitle>
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

        <div className="space-y-3">
          <h3 className="text-sm font-medium">Presets</h3>
          {presetsQuery.isError ? (
            <p className="text-sm text-muted-foreground">
              The presets could not be loaded. You can still edit each threshold
              below.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {presets.map((preset) => {
                const active = activePreset?.name === preset.name;
                return (
                  <button
                    key={preset.name}
                    type="button"
                    data-testid={`smurf-boost-preset-${preset.name}`}
                    aria-pressed={active}
                    disabled={busy || active}
                    onClick={() =>
                      saveMutation.mutate(writableSettings(preset.thresholds))
                    }
                    className={`rounded-md border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border/60 hover:border-primary/60"
                    }`}
                  >
                    <span className="block text-sm font-semibold">
                      {presetLabel(preset.name)}
                      {active && " — in use"}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {presetDescription(preset.name)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {presets.length > 0 && !activePreset && (
            <p className="text-xs text-muted-foreground">
              Your thresholds do not match any preset. Choosing one replaces
              every value below.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium">Thresholds</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {THRESHOLD_FIELDS.map((field) => (
              <div key={field.name} className="space-y-1">
                <Label htmlFor={`smurf-boost-${field.name}`}>
                  {field.label}
                </Label>
                <Input
                  id={`smurf-boost-${field.name}`}
                  type="number"
                  inputMode="decimal"
                  step={field.integer ? 1 : 0.01}
                  min={field.min}
                  max={field.max}
                  disabled={busy}
                  aria-invalid={Boolean(
                    errors[field.name] ??
                      (crossError && CROSS_FIELD_NAMES.includes(field.name)),
                  )}
                  aria-describedby={[
                    `smurf-boost-${field.name}-help`,
                    errors[field.name] ? `smurf-boost-${field.name}-error` : "",
                    crossError && CROSS_FIELD_NAMES.includes(field.name)
                      ? "smurf-boost-cross-error"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  value={values[field.name]}
                  onChange={(event) =>
                    setDraft({ ...values, [field.name]: event.target.value })
                  }
                />
                <p
                  id={`smurf-boost-${field.name}-help`}
                  className="text-xs text-muted-foreground"
                >
                  {field.explanation} Allowed: {field.min} to {field.max}.
                </p>
                {errors[field.name] && (
                  <p
                    id={`smurf-boost-${field.name}-error`}
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {errors[field.name]}
                  </p>
                )}
              </div>
            ))}
          </div>
          {crossError && (
            <p
              id="smurf-boost-cross-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {crossError}
            </p>
          )}
        </div>

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

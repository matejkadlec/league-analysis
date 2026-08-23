"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Loader2,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCardPreferences,
  getSmurfBoostPresets,
  resetCardPreference,
  updateCardPreference,
} from "../smurf-boost-api";
import { unwrap } from "@/lib/core/http/api";
import { apiErrorMessage } from "@/lib/core/http/api-error";
import { useToast } from "@/lib/core/hooks";
import type { CardPreference, SmurfBoostPreset } from "@/lib/core/schemas";

import {
  crossFieldError,
  fieldError,
  numericSettings,
  SMURF_BOOST_CARD_ID,
  THRESHOLD_FIELDS,
  byThreshold,
  type ThresholdName,
  type ThresholdSettings,
} from "../smurf-boost-settings";
import { SmurfBoostSettingsPresets } from "./smurf-boost-settings-presets";
import { SmurfBoostSettingsThresholds } from "./smurf-boost-settings-thresholds";

const PREFERENCE_KEY = ["card-preferences"] as const;
const PRESETS_KEY = ["smurf-boost-presets"] as const;

/**
 * Detection Settings behind a button: the form is a page's worth of fields
 * that most visits never touch, so it lives in a dialog rather than a card in
 * the reading flow. The trigger stays enabled through every query state.
 */
export function SmurfBoostSettingsDialog() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<ThresholdName, string> | null>(
    null,
  );
  const [failure, setFailure] = useState<string | null>(null);

  const presetsQuery = useQuery({
    queryKey: PRESETS_KEY,
    queryFn: async ({ signal }) => {
      return unwrap(await getSmurfBoostPresets(signal));
    },
    staleTime: 3600000,
    retry: false,
  });

  const preferenceQuery = useQuery({
    queryKey: PREFERENCE_KEY,
    queryFn: async ({ signal }) => {
      return unwrap(await getCardPreferences(signal));
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
    mutationFn: async (settings: ThresholdSettings) => {
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

  let body: ReactNode;
  if (preferenceQuery.isLoading) {
    body = (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  } else if (!preference) {
    body = (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Your settings could not be loaded, so the comparison runs with the
          shipped defaults.
        </AlertDescription>
      </Alert>
    );
  } else {
    const effective = numericSettings(preference.settings);
    const values =
      draft ??
      byThreshold((field) => String(effective[field.name] ?? ""));

    const parsed = byThreshold((field) => {
      const raw = values[field.name];
      return raw.trim() === "" ? Number.NaN : Number(raw);
    });
    const errors: Partial<Record<ThresholdName, string>> = {};
    for (const field of THRESHOLD_FIELDS) {
      const message = fieldError(field, parsed[field.name]);
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

    body = (
      <div className="space-y-4">
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
      </div>
    );
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        // A draft abandoned by closing the dialog must not greet the next
        // open as if it were the stored settings.
        if (!open) {
          setDraft(null);
          setFailure(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {/* `sm`, because the trigger sits in the run card's header row. */}
        <Button variant="outline" size="sm">
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Detection Settings
        </Button>
      </DialogTrigger>
      {/* Wide enough that the grouped thresholds fit without the dialog
          scrolling; the max-h/overflow pair is a guard for short viewports,
          not a layout the content is expected to reach. */}
      <DialogContent
        id="smurf-boost-settings"
        className="max-h-[92vh] max-w-6xl overflow-y-auto p-5"
        // A stray click on the dimmed page or a reflexive Escape must not
        // throw away an edited draft: fifteen fields are a lot to retype.
        // The X and the Discard button remain the deliberate ways out.
        onInteractOutside={(event) => {
          if (draft !== null) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (draft !== null) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-gold-base" />
              Detection Settings
            </DialogTitle>
            {preference && (
              <Badge variant="outline" className="mr-6 sm:ml-auto">
                {preference.isDefault ? "Shipped defaults" : "Your settings"}
              </Badge>
            )}
          </div>
          <DialogDescription>
            These thresholds are yours alone and apply to every comparison you
            run. They change how easily an area is called unusual; they never
            change what the reading means.
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

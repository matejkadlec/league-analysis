"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { THRESHOLD_FIELDS } from "../smurf-boost-settings";
import { FAMILY_TITLES } from "../smurf-boost-vocabulary";
import { cn } from "@/lib/core/utils";

const CROSS_FIELD_NAMES = ["recentWindowSize", "a3MinimumNovelGames"];

/**
 * The fifteen thresholds grouped by what they tune, one tab each. Every group
 * stays mounted (`forceMount`) and is only visually hidden: the cross-field
 * rule spans two groups, and `aria-describedby` needs a mounted target.
 */
const GROUPS = [
  {
    value: "windows",
    title: "Games Compared",
    match: /^(recent|baseline)/,
    // Column counts are per group so every group fits its fields in at most
    // two rows -- that is what lets the dialog hold any tab without its own
    // scrollbar at ordinary desktop heights.
    columns: "sm:grid-cols-2",
  },
  {
    value: "rapid",
    title: FAMILY_TITLES.rapid_improvement,
    match: /^a\d/,
    columns: "sm:grid-cols-2 lg:grid-cols-3",
  },
  {
    value: "pattern",
    title: FAMILY_TITLES.playing_pattern_change,
    match: /^b\d/,
    columns: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  },
];

interface SmurfBoostSettingsThresholdsProps {
  values: Record<string, string>;
  errors: Record<string, string>;
  crossError: string | null;
  busy: boolean;
  onChange: (name: string, value: string) => void;
}

export function SmurfBoostSettingsThresholds({
  values,
  errors,
  crossError,
  busy,
  onChange,
}: SmurfBoostSettingsThresholdsProps) {
  const groupHasProblem = (match: RegExp) =>
    THRESHOLD_FIELDS.some(
      (field) =>
        match.test(field.name) &&
        (errors[field.name] !== undefined ||
          (crossError !== null && CROSS_FIELD_NAMES.includes(field.name))),
    );

  return (
    <div className="space-y-3">
      <h4 className="text-base font-semibold">Thresholds</h4>
      <Tabs defaultValue="windows">
        <TabsList className="h-auto flex-wrap justify-start">
          {GROUPS.map((group) => (
            <TabsTrigger key={group.value} value={group.value}>
              {group.title}
              {/* Decorative: the accessible signal is each field's
                  aria-invalid and the role="alert" messages. A label here
                  would leak into the tab's accessible name. */}
              {groupHasProblem(group.match) && (
                <span
                  aria-hidden="true"
                  className="ml-2 h-1.5 w-1.5 rounded-full bg-destructive"
                />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* From `sm` up every group occupies the same grid cell, so switching
            tabs cannot move the tab row out from under the pointer. On a phone
            the dialog scrolls, so an inactive group stays fully hidden. */}
        <div className="sm:grid">
          {GROUPS.map((group, index) => (
            <TabsContent
              key={group.value}
              value={group.value}
              forceMount
              className="mt-2 block rounded-lg border border-border/60 bg-card/40 p-3 data-[state=inactive]:hidden sm:col-start-1 sm:row-start-1 sm:data-[state=inactive]:block sm:data-[state=inactive]:invisible"
            >
              <div
                id={index === 0 ? "smurf-boost-thresholds-grid" : undefined}
                data-testid={`smurf-boost-thresholds-${group.value}`}
                className={cn("grid gap-x-6 gap-y-3", group.columns)}
              >
                {THRESHOLD_FIELDS.filter((field) =>
                  group.match.test(field.name),
                ).map((field) => (
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
                        errors[field.name]
                          ? `smurf-boost-${field.name}-error`
                          : "",
                        crossError && CROSS_FIELD_NAMES.includes(field.name)
                          ? "smurf-boost-cross-error"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      value={values[field.name]}
                      onChange={(event) =>
                        onChange(field.name, event.target.value)
                      }
                    />
                    <p
                      id={`smurf-boost-${field.name}-help`}
                      className="text-sm leading-snug text-muted-foreground"
                    >
                      {field.explanation} Allowed: {field.min} to {field.max}.
                    </p>
                    {errors[field.name] && (
                      <p
                        id={`smurf-boost-${field.name}-error`}
                        role="alert"
                        className="text-sm text-destructive"
                      >
                        {errors[field.name]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </TabsContent>
          ))}
        </div>
      </Tabs>
      {crossError && (
        <p
          id="smurf-boost-cross-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {crossError}
        </p>
      )}
    </div>
  );
}

"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { THRESHOLD_FIELDS } from "../smurf-boost-settings";
import { FAMILY_TITLES } from "../smurf-boost-vocabulary";

const CROSS_FIELD_NAMES = ["recentWindowSize", "a3MinimumNovelGames"];

/**
 * The fifteen thresholds shown as one flat grid were a wall: nothing said
 * which area a value belonged to, and the dialog needed a scrollbar to hold
 * them. They group naturally by what they tune -- the two window sizes, the
 * A-family and the B-family -- so each group gets a tab, named with the same
 * family titles the rest of the page already uses.
 *
 * Every group stays mounted (`forceMount`) and is only visually hidden when
 * inactive: the values live in one draft, the cross-field rule spans two
 * groups, and an `aria-describedby` must never point at an element that has
 * been unmounted from under it.
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
        {GROUPS.map((group, index) => (
          <TabsContent
            key={group.value}
            value={group.value}
            forceMount
            className="mt-3 rounded-lg border border-border/60 bg-card/40 p-4 data-[state=inactive]:hidden"
          >
            <div
              id={index === 0 ? "smurf-boost-thresholds-grid" : undefined}
              data-testid={`smurf-boost-thresholds-${group.value}`}
              className={`grid gap-x-6 gap-y-4 ${group.columns}`}
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

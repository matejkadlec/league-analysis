"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { THRESHOLD_FIELDS } from "../smurf-boost-settings";

const CROSS_FIELD_NAMES = ["recentWindowSize", "a3MinimumNovelGames"];

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
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">Thresholds</h3>
      <div
        id="smurf-boost-thresholds-grid"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {THRESHOLD_FIELDS.map((field) => (
          <div key={field.name} className="space-y-1">
            <Label htmlFor={`smurf-boost-${field.name}`}>{field.label}</Label>
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
              onChange={(event) => onChange(field.name, event.target.value)}
            />
            <p
              id={`smurf-boost-${field.name}-help`}
              className="text-sm text-muted-foreground"
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

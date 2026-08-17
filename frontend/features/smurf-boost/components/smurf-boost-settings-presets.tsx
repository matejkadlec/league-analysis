"use client";

import type { SmurfBoostPreset } from "@/lib/core/schemas";

import {
  matchesPreset,
  presetDescription,
  presetLabel,
  writableSettings,
} from "../smurf-boost-settings";

interface SmurfBoostSettingsPresetsProps {
  presets: SmurfBoostPreset[];
  isError: boolean;
  busy: boolean;
  effective: Record<string, number>;
  onSelect: (settings: Record<string, number>) => void;
}

export function SmurfBoostSettingsPresets({
  presets,
  isError,
  busy,
  effective,
  onSelect,
}: SmurfBoostSettingsPresetsProps) {
  const activePreset = presets.find((preset) =>
    matchesPreset(effective, preset.thresholds),
  );

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Presets</h3>
      {isError ? (
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
                onClick={() => onSelect(writableSettings(preset.thresholds))}
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
          Your thresholds do not match any preset. Choosing one replaces every
          value below.
        </p>
      )}
    </div>
  );
}

"use client";

import { useAuth } from "@/features/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail } from "lucide-react";
import { ACCOUNT_ACTION_BUTTON_CLASS } from "../settings-helpers";

interface EmailSettingsSectionProps {
  onChangeEmail: () => void;
  isSubmitting: boolean;
  isLocked: boolean;
}

export function EmailSettingsSection({
  onChangeEmail,
  isSubmitting,
  isLocked,
}: EmailSettingsSectionProps) {
  const { user } = useAuth();

  return (
    <div className="space-y-1.5">
      <Label htmlFor="current-email">Current Email</Label>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-3">
        <Input
          id="current-email"
          type="email"
          value={user?.email ?? ""}
          disabled
          className="w-full"
        />
        <div className="flex items-center justify-end">
          <button
            type="button"
            className={ACCOUNT_ACTION_BUTTON_CLASS}
            onClick={onChangeEmail}
            disabled={isSubmitting || isLocked}
          >
            <Mail className="h-4 w-4" />
            Change
          </button>
        </div>
      </div>
      {isLocked && (
        <p className="text-xs text-red-500">
          Too many failed attempts. Try again in 5 minutes.
        </p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { validatedPatch } from "@/lib/core/api";
import {
  UserResponseSchema,
  type UserProfileUpdate,
} from "@/lib/core/schemas";
import { useAuth } from "@/features/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/core/hooks";
import { Loader2, Save } from "lucide-react";
import {
  ACCOUNT_ACTION_BUTTON_CLASS,
  USER_QUERY_KEY,
  toMutationError,
} from "./settings-helpers";

export function DisplayNameField() {
  const toast = useToast();
  const { user, checkAuth } = useAuth();
  const queryClient = useQueryClient();
  const [draftDisplayName, setDraftDisplayName] = useState<string | null>(null);

  const currentDisplayName = user?.display_name ?? "";
  const displayName = draftDisplayName ?? currentDisplayName;
  const displayNameDirty =
    draftDisplayName !== null && draftDisplayName !== currentDisplayName;

  const updateDisplayNameMutation = useMutation({
    mutationFn: async (update: UserProfileUpdate) => {
      const result = await validatedPatch(
        UserResponseSchema,
        "/auth/me",
        update,
      );
      if (!result.success) {
        throw toMutationError(result.error);
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USER_QUERY_KEY });
      void checkAuth();
      setDraftDisplayName(null);
      toast.success("Display name updated", {
        duration: 1000,
      });
    },
    onError: () => {
      toast.error("Display name was not updated", {
        description: "Please try again later.",
      });
    },
  });

  const handleDisplayNameChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const nextDisplayName = event.target.value;
    setDraftDisplayName(
      nextDisplayName === currentDisplayName ? null : nextDisplayName,
    );
  };

  const handleSaveDisplayName = () => {
    const trimmed = displayName.trim();

    if (!trimmed) {
      toast.warning("Enter a display name");
      return;
    }

    if (trimmed.length < 3) {
      toast.warning("Display name too short", {
        description: "Use at least 3 characters.",
      });
      return;
    }

    const validPattern = /^[\p{L}](?:[\p{L}\p{M}_ ]*[\p{L}])?$/u;
    if (!validPattern.test(trimmed)) {
      toast.warning("Check the display name", {
        description:
          "Must only contain letters, underscores, and spaces. Cannot start or end with space or underscore.",
      });
      return;
    }

    if (!/^[\p{L}\p{M}_ ]+$/u.test(trimmed)) {
      toast.warning("Check the display name characters", {
        description:
          "Only letters, underscores, and spaces are allowed in the display name.",
      });
      return;
    }

    updateDisplayNameMutation.mutate({ display_name: trimmed });
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="display-name">Display Name</Label>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-3">
        <Input
          id="display-name"
          value={displayName}
          onChange={handleDisplayNameChange}
          maxLength={128}
          disabled={updateDisplayNameMutation.isPending}
          className="w-full"
        />
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={handleSaveDisplayName}
            className={ACCOUNT_ACTION_BUTTON_CLASS}
            disabled={
              !displayNameDirty || updateDisplayNameMutation.isPending
            }
          >
            {updateDisplayNameMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

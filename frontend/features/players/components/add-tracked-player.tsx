"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addTrackedPlayerSchema,
  type AddTrackedPlayerForm,
} from "@/lib/core/validations";
import { addTrackedPlayer } from "@/lib/core/api";
import { PlayerSchema } from "@/lib/core/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { UserPlus, AlertCircle } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";

const SERVER_MAPPING: Record<string, string> = {
  eun1: "EUNE",
  euw1: "EUW",
  na1: "NA",
  kr: "KR",
  br1: "BR",
  la1: "LAN",
  la2: "LAS",
  oc1: "OCE",
  ru: "RU",
  tr1: "TR",
  jp1: "JP",
  ph2: "PH",
  sg2: "SG",
  th2: "TH",
  tw2: "TW",
  vn2: "VN",
};

export function AddTrackedPlayer() {
  const queryClient = useQueryClient();

  const form = useForm<AddTrackedPlayerForm>({
    resolver: zodResolver(addTrackedPlayerSchema),
    defaultValues: {
      searchValue: "#", // Default with #
      platform: "eun1",
    },
  });

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async (data: AddTrackedPlayerForm) => {
      // Smart format detection
      let game_name = data.searchValue;
      let tag_line = "";

      if (data.searchValue.includes("#")) {
        const parts = data.searchValue.split("#");
        game_name = parts[0];
        tag_line = parts.slice(1).join("#");
      }

      const result = await addTrackedPlayer({
        game_name,
        tag_line,
        platform: data.platform,
      });

      if (!result.success) {
        // Map backend error to specific message if needed
        if (result.error.message.includes("not found")) {
          const serverName =
            SERVER_MAPPING[data.platform] || data.platform.toUpperCase();
          throw new Error(
            `Player with this name and tag wasn't found on server ${serverName}.`,
          );
        }
        throw new Error(result.error.message);
      }

      // Validate the response
      const parsed = PlayerSchema.safeParse(result.data);
      if (!parsed.success) {
        throw new Error("Invalid player data received from server");
      }

      return parsed.data;
    },
    onSuccess: (player) => {
      // Invalidate tracked players list to refresh
      queryClient.invalidateQueries({ queryKey: ["tracked-players"] });

      // Show success toast
      toast.success(
        `Successfully added ${player.game_name} to tracked players!`,
      );

      // Reset form
      form.reset({
        searchValue: "",
        platform: form.getValues("platform"),
      });

      // Clear error state
      reset();
    },
    onError: () => {
      // Error is already captured in the mutation
      // We'll display it below the form
    },
  });

  const onSubmit = (data: AddTrackedPlayerForm) => {
    mutate(data);
  };

  {
    /* TODO [SPY-66]: Change design and layout to be the same as Player Search  */
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-2">
          <UserPlus className="h-5 w-5 text-primary" />
          <CardTitle>Add Player For Tracking</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="searchValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Player Name With Tag</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="John Doe#EUNE"
                      disabled={isPending}
                      {...field}
                      onChange={(e) => {
                        let val = e.target.value;

                        // 7.4: Filter special symbols (allow letters, numbers, foreign chars, space, #, -)
                        // Disallow: $ ! ? etc.
                        // Regex to remove forbidden symbols.
                        // Allowed: \w (alphanumeric + _), space, #, -, and unicode letters.
                        // Ideally we construct valid regex for all letters.
                        // Easier: remove known bad symbols.
                        const forbiddenPattern =
                          /[!$@%^&*()+={}\[\]|\\:;"'<>,?/~`]/g;
                        if (forbiddenPattern.test(val)) {
                          // Remove them
                          val = val.replace(forbiddenPattern, "");
                        }

                        // 7.3: Ensure # is present and cannot be deleted
                        // If user tries to delete # (new val has no #), we reject the change (keep old value)
                        // OR we re-insert it?
                        // If we simply reject, it feels like it's stuck.
                        // Let's try to be smart. If missing, append it?
                        if (!val.includes("#")) {
                          // User deleted #.
                          // If they backspaced, maybe we shouldn't block, but re-add it?
                          // But where?
                          // Let's just block the removal of #.
                          // Only update if # is still there.
                          // Wait, if they select all and delete? -> val is empty.
                          // Then we reset to "#".
                          if (val === "") {
                            val = "#";
                          } else {
                            // They deleted just the #?
                            // Restore the previous # location? tricky.
                            // Let's just append it if missing, or prepend.
                            // Simpler: If no hash, keep the field.value (effectively blocking deletion)
                            /* 
                                  Actually, blocking deletion is the best interpretation of 
                                  "cannot delete it".
                               */
                            return;
                          }
                        }

                        field.onChange(val);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="platform"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Server</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isPending}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a server" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-h-[350px]">
                      <SelectItem value="eun1">EU Nordic & East</SelectItem>
                      <SelectItem value="euw1">EU West</SelectItem>
                      <SelectItem value="na1">North America</SelectItem>
                      <SelectItem value="kr">Korea</SelectItem>
                      <SelectItem value="br1">Brazil</SelectItem>
                      <SelectItem value="la1">Latin America North</SelectItem>
                      <SelectItem value="la2">Latin America South</SelectItem>
                      <SelectItem value="oc1">Oceania</SelectItem>
                      <SelectItem value="ru">Russia</SelectItem>
                      <SelectItem value="tr1">Turkey</SelectItem>
                      <SelectItem value="jp1">Japan</SelectItem>
                      <SelectItem value="ph2">Philippines</SelectItem>
                      <SelectItem value="sg2">Singapore</SelectItem>
                      <SelectItem value="th2">Thailand</SelectItem>
                      <SelectItem value="tw2">Taiwan</SelectItem>
                      <SelectItem value="vn2">Vietnam</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                  Adding Player...
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Track Player
                </>
              )}
            </Button>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {error instanceof Error && error.message
                    ? error.message
                    : "Failed to add tracked player. Please check your input and try again."}
                </AlertDescription>
              </Alert>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

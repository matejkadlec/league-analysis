"use client";

import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { PlayerSchema } from "@/lib/core/schemas";
import { addTrackedPlayer } from "@/lib/core/api";
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
import { useAuth } from "@/features/auth";

// Server to flag mapping
const SERVER_FLAGS: Record<string, string> = {
  euw1: "🇪🇺",
  eun1: "🇪🇺",
  na1: "🇺🇸",
  kr: "🇰🇷",
  tr1: "🇹🇷",
  br1: "🇧🇷",
  la1: "🇲🇽",
  la2: "🇦🇷",
  oc1: "🇦🇺",
  ru: "🇷🇺",
  jp1: "🇯🇵",
  tw2: "🇹🇼",
  vn2: "🇻🇳",
  ph2: "🇵🇭",
  sg2: "🇸🇬",
  th2: "🇹🇭",
};

// Server display names
const SERVER_NAMES: Record<string, string> = {
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

// Character limits
const GAME_NAME_MAX = 16;
const TAG_MAX = 5;

// Validation schema for the form
const addTrackedPlayerFormSchema = z.object({
  gameName: z
    .string()
    .min(1, "Game name is required")
    .regex(
      /^[a-zA-Z0-9\s.\-_\u00C0-\u024F\u1E00-\u1EFF]+$/,
      "Game name contains invalid characters",
    ),
  tagLine: z
    .string()
    .min(1, "Tag is required")
    .regex(/^[a-zA-Z0-9]+$/, "Tag can only contain letters and numbers"),
  platform: z.string().min(1, "Server is required"),
});

type AddTrackedPlayerFormValues = z.infer<typeof addTrackedPlayerFormSchema>;

export function AddTrackedPlayer() {
  const queryClient = useQueryClient();
  const gameNameInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const userId = user?.id;

  const form = useForm<AddTrackedPlayerFormValues>({
    resolver: zodResolver(addTrackedPlayerFormSchema),
    defaultValues: {
      gameName: "",
      tagLine: "",
      platform: "eun1",
    },
    mode: "onChange", // Enable real-time validation
  });

  // Auto-focus on game name input when component mounts
  useEffect(() => {
    gameNameInputRef.current?.focus();
  }, []);

  // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch() is intentionally not memoizable
  const gameName = form.watch("gameName");
  const tagLine = form.watch("tagLine");

  // Check if over character limits (for warning display)
  const gameNameOverLimit = gameName.length > GAME_NAME_MAX;
  const tagOverLimit = tagLine.length > TAG_MAX;

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async (data: AddTrackedPlayerFormValues) => {
      // Additional validation for character limits
      if (data.gameName.length > GAME_NAME_MAX) {
        throw new Error(
          `Game name must be ${GAME_NAME_MAX} characters or less`,
        );
      }
      if (data.tagLine.length > TAG_MAX) {
        throw new Error(`Tag must be ${TAG_MAX} characters or less`);
      }

      const result = await addTrackedPlayer({
        game_name: data.gameName,
        tag_line: data.tagLine,
        platform: data.platform,
      });

      if (!result.success) {
        if (result.error.message.includes("not found")) {
          const serverName =
            SERVER_NAMES[data.platform] || data.platform.toUpperCase();
          throw new Error(
            `Player with this name and tag wasn't found on server ${serverName}.`,
          );
        }
        throw new Error(result.error.message);
      }

      const parsed = PlayerSchema.safeParse(result.data);
      if (!parsed.success) {
        throw new Error("Invalid player data received from server");
      }

      return parsed.data;
    },
    onSuccess: (player) => {
      queryClient.invalidateQueries({ queryKey: ["tracked-players", userId] });
      queryClient.invalidateQueries({
        queryKey: ["tracking-status", userId, player.puuid],
      });
      queryClient.invalidateQueries({ queryKey: ["player", player.puuid] });
      toast.success(
        `Successfully added ${player.game_name} to tracked players!`,
      );
      form.reset({
        gameName: "",
        tagLine: "",
        platform: form.getValues("platform"),
      });
      reset();
      // Re-focus on game name input after successful submission
      gameNameInputRef.current?.focus();
    },
  });

  const onSubmit = (data: AddTrackedPlayerFormValues) => {
    mutate(data);
  };

  // Determine warning/error states for character limits
  const getGameNameLimitClass = () => {
    if (!gameNameOverLimit) return "text-muted-foreground";
    if (error) return "text-destructive";
    return "text-amber-500";
  };

  const getTagLimitClass = () => {
    if (!tagOverLimit) return "text-muted-foreground";
    if (error) return "text-destructive";
    return "text-amber-500";
  };

  return (
    <Card id="add-tracked-player">
      <CardHeader>
        <div className="flex items-center space-x-2">
          <UserPlus className="h-5 w-5 text-primary" />
          <CardTitle>Add Player For Tracking</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* First Row: Game Name, Tag, Server */}
            <div className="grid grid-cols-12 gap-3">
              {/* Game Name - takes 5/12 */}
              <div className="col-span-5">
                <FormField
                  control={form.control}
                  name="gameName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Game Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="John Doe"
                          disabled={isPending}
                          {...field}
                          ref={(e) => {
                            field.ref(e);
                            (
                              gameNameInputRef as React.MutableRefObject<HTMLInputElement | null>
                            ).current = e;
                          }}
                          tabIndex={1}
                        />
                      </FormControl>
                      <div className="flex justify-between items-center">
                        <FormMessage />
                        {gameName.length > 0 && (
                          <span
                            className={`text-xs ${getGameNameLimitClass()}`}
                          >
                            {gameName.length}/{GAME_NAME_MAX}
                          </span>
                        )}
                      </div>
                    </FormItem>
                  )}
                />
                <p className="text-xs text-muted-foreground">Enter game name</p>
              </div>

              {/* Tag - takes 3/12 */}
              <div className="col-span-3">
                <FormField
                  control={form.control}
                  name="tagLine"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tag Line</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="EUNE"
                          disabled={isPending}
                          {...field}
                          tabIndex={2}
                        />
                      </FormControl>
                      <div className="flex justify-between items-center">
                        <FormMessage />
                        {tagLine.length > 0 && (
                          <span className={`text-xs ${getTagLimitClass()}`}>
                            {tagLine.length}/{TAG_MAX}
                          </span>
                        )}
                      </div>
                    </FormItem>
                  )}
                />
                <p className="text-xs text-muted-foreground">Enter tag line</p>
              </div>

              {/* Server - takes 3/12 */}
              <div className="col-span-3">
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
                          <SelectTrigger tabIndex={3}>
                            <SelectValue placeholder="Select server" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="eun1">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.eun1}</span>
                              <span>EUNE</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="euw1">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.euw1}</span>
                              <span>EUW</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="na1">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.na1}</span>
                              <span>NA</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="kr">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.kr}</span>
                              <span>KR</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="tr1">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.tr1}</span>
                              <span>TR</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="br1">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.br1}</span>
                              <span>BR</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="la1">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.la1}</span>
                              <span>LAN</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="la2">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.la2}</span>
                              <span>LAS</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="oc1">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.oc1}</span>
                              <span>OCE</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="ru">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.ru}</span>
                              <span>RU</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="jp1">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.jp1}</span>
                              <span>JP</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="tw2">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.tw2}</span>
                              <span>TW</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="vn2">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.vn2}</span>
                              <span>VN</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="ph2">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.ph2}</span>
                              <span>PH</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="sg2">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.sg2}</span>
                              <span>SG</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="th2">
                            <span className="flex items-center space-x-2">
                              <span>{SERVER_FLAGS.th2}</span>
                              <span>TH</span>
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Select server
                      </p>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Button
              type="submit"
              className="button-full"
              disabled={isPending || gameNameOverLimit || tagOverLimit}
              tabIndex={4}
            >
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

"use client";

import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { connectRiotAccount } from "@/lib/core/api";
import { useAuth } from "@/features/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Link2, AlertCircle, StopCircle } from "lucide-react";
import { useToast } from "@/lib/core/hooks";

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
const connectRiotAccountFormSchema = z.object({
  gameName: z
    .string()
    .min(1, "Game name is required")
    .max(GAME_NAME_MAX, `Game name must be ${GAME_NAME_MAX} characters or less`)
    .regex(
      /^[a-zA-Z0-9\s.\-_\u00C0-\u024F\u1E00-\u1EFF]+$/,
      "Game name contains invalid characters",
    ),
  tagLine: z
    .string()
    .min(1, "Tag is required")
    .max(TAG_MAX, `Tag must be ${TAG_MAX} characters or less`)
    .regex(/^[a-zA-Z0-9]+$/, "Tag can only contain letters and numbers"),
  platform: z.string().min(1, "Server is required"),
});

type ConnectRiotAccountFormValues = z.infer<
  typeof connectRiotAccountFormSchema
>;

interface ConnectRiotAccountDialogProps {
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

export function ConnectRiotAccountDialog({
  trigger,
  onSuccess,
}: ConnectRiotAccountDialogProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { checkAuth } = useAuth();
  const gameNameInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<ConnectRiotAccountFormValues>({
    resolver: zodResolver(connectRiotAccountFormSchema),
    defaultValues: {
      gameName: "",
      tagLine: "",
      platform: "eun1",
    },
    mode: "onChange",
  });

  // Auto-focus on game name input when dialog opens
  useEffect(() => {
    if (open) {
      // Small delay to ensure dialog is rendered
      setTimeout(() => {
        gameNameInputRef.current?.focus();
      }, 100);
    }
  }, [open]);

  // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch() is intentionally not memoizable
  const gameName = form.watch("gameName");
  const tagLine = form.watch("tagLine");

  // Check if over character limits
  const gameNameOverLimit = gameName.length > GAME_NAME_MAX;
  const tagOverLimit = tagLine.length > TAG_MAX;

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async (data: ConnectRiotAccountFormValues) => {
      const result = await connectRiotAccount({
        game_name: data.gameName,
        tag_line: data.tagLine,
        platform: data.platform,
      });

      if (!result.success) {
        if (
          result.error.message.includes("not found") ||
          result.error.status === 404
        ) {
          const serverName =
            SERVER_NAMES[data.platform] || data.platform.toUpperCase();
          throw new Error(
            `Player with this name and tag wasn't found on server ${serverName}.`,
          );
        }
        // Handle API key errors with user-friendly message
        if (
          result.error.code === "RIOT_API_KEY_INVALID" ||
          result.error.status === 503
        ) {
          throw new Error(
            "The Riot API key is invalid or expired. Please contact an administrator.",
          );
        }
        throw new Error(result.error.message);
      }

      return result.data;
    },
    onSuccess: () => {
      toast.success("Riot account connected", {
        description: "The selected Riot account is now linked.",
      });
      form.reset();
      reset();
      setOpen(false);
      // Refresh user data to get updated riot_account_connected status
      checkAuth();
      onSuccess?.();
    },
  });

  const onSubmit = (data: ConnectRiotAccountFormValues) => {
    mutate(data);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset form and error when closing
      form.reset();
      reset();
    }
    setOpen(newOpen);
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="button-medium">
            <Link2 className="h-5 w-5" />
            Connect Riot Account
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] dialog-white-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-[#cfa93a]" />
            Connect Riot Account
          </DialogTitle>
          <DialogDescription>
            Enter your Riot Games account details to link your account and view
            your statistics.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Game Name */}
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
                    />
                  </FormControl>
                  <div className="flex justify-between items-center">
                    <FormMessage />
                    {gameName.length > 0 && (
                      <span className={`text-xs ${getGameNameLimitClass()}`}>
                        {gameName.length}/{GAME_NAME_MAX}
                      </span>
                    )}
                  </div>
                </FormItem>
              )}
            />

            {/* Tag Line */}
            <FormField
              control={form.control}
              name="tagLine"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tag Line</FormLabel>
                  <FormControl>
                    <Input placeholder="EUNE" disabled={isPending} {...field} />
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

            {/* Server */}
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
                </FormItem>
              )}
            />

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {error instanceof Error && error.message
                    ? error.message
                    : "Failed to connect Riot account. Please check your input and try again."}
                </AlertDescription>
              </Alert>
            )}

            <div className="mt-4 flex items-center justify-between gap-2">
              <Button
                type="button"
                className="red-gradient py-2 px-4"
                onClick={() => handleOpenChange(false)}
                disabled={isPending}
              >
                <StopCircle className="h-4 w-4" />
                Cancel
              </Button>
              <button
                type="submit"
                className="button-medium"
                disabled={isPending || gameNameOverLimit || tagOverLimit}
              >
                {isPending ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Link2 className="h-4 w-4" />
                    Connect
                  </>
                )}
              </button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

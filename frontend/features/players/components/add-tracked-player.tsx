"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addTrackedPlayer,
  searchPlayerSuggestions,
  trackPlayer,
} from "../player-api";
import { useToast } from "@/lib/core/hooks";
import { Player, PlayerSchema } from "@/lib/core/schemas";
import { useAuth } from "@/features/auth";

import { parseRiotId } from "../utils/riot-id";
import {
  PlayerTrackingError,
  toPlayerTrackingError,
} from "../utils/tracking-feedback";

const SUGGESTION_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 1;

const SERVERS = [
  ["eun1", "🇪🇺", "EUNE"],
  ["euw1", "🇪🇺", "EUW"],
  ["na1", "🇺🇸", "NA"],
  ["kr", "🇰🇷", "KR"],
  ["tr1", "🇹🇷", "TR"],
  ["br1", "🇧🇷", "BR"],
  ["la1", "🇲🇽", "LAN"],
  ["la2", "🇦🇷", "LAS"],
  ["oc1", "🇦🇺", "OCE"],
  ["ru", "🇷🇺", "RU"],
  ["jp1", "🇯🇵", "JP"],
  ["tw2", "🇹🇼", "TW"],
  ["vn2", "🇻🇳", "VN"],
  ["ph2", "🇵🇭", "PH"],
  ["sg2", "🇸🇬", "SG"],
  ["th2", "🇹🇭", "TH"],
] as const;

interface AddTrackedPlayerFormValues {
  searchValue: string;
  platform: string;
}

function displayRiotId(player: Player): string {
  const gameName = player.game_name || "Unknown player";

  return player.tag_line ? `${gameName}#${player.tag_line}` : gameName;
}

function isExactRiotIdMatch(
  player: Player,
  gameName: string,
  tagLine: string,
): boolean {
  return (
    (player.game_name ?? "").trim().toLocaleLowerCase() ===
      gameName.toLocaleLowerCase() &&
    (player.tag_line ?? "").trim().toLocaleLowerCase() ===
      tagLine.toLocaleLowerCase()
  );
}

export function AddTrackedPlayer() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<Player | null>(
    null,
  );
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [debouncedSearchValue, setDebouncedSearchValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [trackingErrorMessage, setTrackingErrorMessage] = useState<
    string | null
  >(null);

  const form = useForm<AddTrackedPlayerFormValues>({
    defaultValues: { searchValue: "", platform: "eun1" },
  });

  // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch() is intentionally not memoizable
  const searchValue = form.watch("searchValue");
  const platform = form.watch("platform");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearchValue(searchValue),
      SUGGESTION_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchValue]);

  const { data: suggestionsResult, isLoading: suggestionsLoading } = useQuery({
    queryKey: ["player-suggestions", debouncedSearchValue, platform],
    queryFn: () =>
      searchPlayerSuggestions({
        q: debouncedSearchValue,
        platform,
        limit: 5,
      }),
    enabled: debouncedSearchValue.length >= MIN_SEARCH_LENGTH,
    retry: 1,
    retryDelay: 500,
  });

  const suggestions = useMemo(
    () => (suggestionsResult?.success ? suggestionsResult.data : []),
    [suggestionsResult],
  );

  const parsedRiotId = useMemo(() => {
    try {
      return parseRiotId(searchValue);
    } catch {
      return null;
    }
  }, [searchValue]);

  const suggestionToTrack = useMemo(() => {
    if (selectedSuggestion) {
      return selectedSuggestion;
    }

    if (parsedRiotId) {
      return suggestions.find((suggestion) =>
        isExactRiotIdMatch(
          suggestion,
          parsedRiotId.gameName,
          parsedRiotId.tagLine,
        ),
      );
    }

    const normalizedName = searchValue.trim().toLocaleLowerCase();
    if (!normalizedName) {
      return undefined;
    }

    return suggestions.find((suggestion) =>
      (suggestion.game_name ?? "").toLocaleLowerCase().includes(normalizedName),
    );
  }, [parsedRiotId, searchValue, selectedSuggestion, suggestions]);

  const canTrackPlayer = Boolean(suggestionToTrack || parsedRiotId);

  useEffect(() => {
    if (suggestions.length > 0 && searchValue.length >= MIN_SEARCH_LENGTH) {
      setShowSuggestions(true);
      setSelectedIndex(-1);
    } else {
      setShowSuggestions(false);
    }
  }, [searchValue, suggestions]);

  const selectSuggestion = useCallback(
    (player: Player) => {
      form.setValue("searchValue", displayRiotId(player), {
        shouldDirty: true,
        shouldValidate: true,
      });
      setSelectedSuggestion(player);
      setShowSuggestions(false);
      setSelectedIndex(-1);
    },
    [form],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (!showSuggestions || suggestions.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) =>
          index < suggestions.length - 1 ? index + 1 : index,
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => (index > 0 ? index - 1 : -1));
      } else if (event.key === "Enter" && selectedIndex >= 0) {
        event.preventDefault();
        // `selectedIndex` never leaves the list bounds, so this always hits.
        const suggestion = suggestions[selectedIndex];
        if (suggestion) {
          selectSuggestion(suggestion);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        setShowSuggestions(false);
        setSelectedIndex(-1);
      }
    },
    [selectSuggestion, selectedIndex, showSuggestions, suggestions],
  );

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: AddTrackedPlayerFormValues) => {
      let result;

      if (suggestionToTrack) {
        result = await trackPlayer(suggestionToTrack.puuid);
      } else {
        const riotId = parseRiotId(data.searchValue);
        result = await addTrackedPlayer({
          game_name: riotId.gameName,
          tag_line: riotId.tagLine,
          platform: data.platform,
        });
      }

      if (!result.success) {
        const riotId = parseRiotId(data.searchValue);
        throw toPlayerTrackingError(result.error, riotId, data.platform);
      }

      const parsed = PlayerSchema.safeParse(result.data);
      if (!parsed.success) {
        throw new Error("Invalid player data received from server");
      }
      return parsed.data;
    },
    onMutate: () => {
      setTrackingErrorMessage(null);
    },
    onSuccess: (player) => {
      const userId = user?.id;
      void queryClient.invalidateQueries({
        queryKey: ["tracked-players", userId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["player-context", userId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["tracking-status", userId, player.puuid],
      });
      void queryClient.invalidateQueries({
        queryKey: ["player", player.puuid],
      });
      toast({
        title: "Player added for tracking",
        description: `${displayRiotId(player)} is now being tracked.`,
        variant: "success",
      });
      form.reset({ searchValue: "", platform: form.getValues("platform") });
      setSelectedSuggestion(null);
      inputRef.current?.focus();
    },
    onError: (error) => {
      if (!(error instanceof PlayerTrackingError)) {
        setTrackingErrorMessage(
          "Failed to add tracked player. Please try again.",
        );
        return;
      }

      if (error.kind === "rate-limited") {
        toast({
          title: "Unable to add player for tracking",
          description:
            "We couldn't load this player's information. Please try again in a few minutes.",
          variant: "warning",
        });
        return;
      }

      if (error.kind === "api-key") {
        toast({
          title: "Player tracking is temporarily unavailable",
          description:
            "The Riot API key is invalid or expired. Please contact an administrator.",
          variant: "error",
        });
        return;
      }

      setTrackingErrorMessage(
        error.kind === "not-found"
          ? error.message
          : "Failed to add tracked player. Please try again.",
      );
    },
  });

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
          <form
            onSubmit={(event) =>
              void form.handleSubmit((data) => {
                if (canTrackPlayer) {
                  mutate(data);
                }
              })(event)
            }
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <FormField
                control={form.control}
                name="searchValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Player Name</FormLabel>
                    <Popover
                      open={showSuggestions}
                      onOpenChange={setShowSuggestions}
                    >
                      <PopoverTrigger asChild>
                        <div className="relative">
                          <FormControl>
                            <Input
                              {...field}
                              ref={(element) => {
                                field.ref(element);
                                inputRef.current = element;
                              }}
                              placeholder="John Doe#EUNE"
                              disabled={isPending}
                              autoComplete="off"
                              onChange={(event) => {
                                field.onChange(event);
                                setSelectedSuggestion(null);
                                setTrackingErrorMessage(null);
                              }}
                              onFocus={() => {
                                if (suggestions.length > 0) {
                                  setShowSuggestions(true);
                                }
                              }}
                              onBlur={() => setShowSuggestions(false)}
                              onKeyDown={handleKeyDown}
                            />
                          </FormControl>
                          {suggestionsLoading &&
                            searchValue.length >= MIN_SEARCH_LENGTH && (
                              <Loader2
                                className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
                                aria-label="Loading suggestions"
                                role="status"
                              />
                            )}
                        </div>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-[var(--radix-popover-trigger-width)] p-0"
                        onOpenAutoFocus={(event) => event.preventDefault()}
                      >
                        <div className="max-h-72 overflow-y-auto py-1">
                          {suggestions.map((suggestion, index) => (
                            <button
                              key={suggestion.puuid}
                              type="button"
                              className={`w-full px-4 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
                                index === selectedIndex
                                  ? "bg-accent text-accent-foreground"
                                  : ""
                              }`}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                selectSuggestion(suggestion);
                              }}
                              onMouseEnter={() => setSelectedIndex(index)}
                            >
                              <span className="font-medium">
                                {displayRiotId(suggestion)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <p className="text-xs text-muted-foreground">
                      Enter game name or tag line to search for players
                    </p>
                    {suggestionToTrack && (
                      <p className="text-xs text-muted-foreground">
                        Tracking saved player {displayRiotId(suggestionToTrack)}
                        .
                      </p>
                    )}
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
                      value={field.value}
                      disabled={isPending}
                      onValueChange={(value) => {
                        field.onChange(value);
                        setSelectedSuggestion(null);
                        setTrackingErrorMessage(null);
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select server" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SERVERS.map(([value, flag, label]) => (
                          <SelectItem key={value} value={value}>
                            <span className="flex items-center space-x-2">
                              <span>{flag}</span>
                              <span>{label}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>

            <Button
              type="submit"
              className="button-full"
              disabled={isPending || !canTrackPlayer}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding Player...
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Track Player
                </>
              )}
            </Button>

            {trackingErrorMessage && (
              <p role="alert" className="text-sm text-muted-foreground">
                {trackingErrorMessage}
              </p>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

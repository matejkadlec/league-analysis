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
import {
  displayRiotId,
  isExactRiotIdMatch,
} from "./add-tracked-player-servers";

export const SUGGESTION_DEBOUNCE_MS = 300;
export const MIN_SEARCH_LENGTH = 1;

export interface AddTrackedPlayerFormValues {
  searchValue: string;
  platform: string;
}

export function useAddTrackedPlayer() {
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

  return {
    form,
    inputRef,
    searchValue,
    showSuggestions,
    setShowSuggestions,
    suggestions,
    suggestionsLoading,
    selectedIndex,
    setSelectedIndex,
    selectedSuggestion,
    setSelectedSuggestion,
    suggestionToTrack,
    canTrackPlayer,
    trackingErrorMessage,
    setTrackingErrorMessage,
    selectSuggestion,
    handleKeyDown,
    mutate,
    isPending,
  };
}

"use client";

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

import { AddTrackedPlayerSuggestions } from "./add-tracked-player-suggestions";
import { SERVERS, displayRiotId } from "./add-tracked-player-servers";
import {
  MIN_SEARCH_LENGTH,
  useAddTrackedPlayer,
} from "./use-add-tracked-player";

export function AddTrackedPlayer() {
  const {
    form,
    inputRef,
    searchValue,
    showSuggestions,
    setShowSuggestions,
    suggestions,
    suggestionsLoading,
    selectedIndex,
    setSelectedIndex,
    setSelectedSuggestion,
    suggestionToTrack,
    canTrackPlayer,
    trackingErrorMessage,
    setTrackingErrorMessage,
    selectSuggestion,
    handleKeyDown,
    mutate,
    isPending,
  } = useAddTrackedPlayer();

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
                        <AddTrackedPlayerSuggestions
                          suggestions={suggestions}
                          selectedIndex={selectedIndex}
                          onSelect={selectSuggestion}
                          onHoverIndex={setSelectedIndex}
                        />
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

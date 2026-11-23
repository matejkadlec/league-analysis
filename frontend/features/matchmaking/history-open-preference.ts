import {
  MATCHMAKING_HISTORY_OPEN_STORAGE_KEY,
  readOptionalStorage,
  writeOptionalStorage,
} from "@/features/cookie-consent";

// Closed unless the viewer opened it and consented to optional storage: the
// history is reference, and the result cards above it are what the page is for.
export function readMatchmakingHistoryOpen(): boolean {
  return readOptionalStorage(MATCHMAKING_HISTORY_OPEN_STORAGE_KEY) === "open";
}

export function persistMatchmakingHistoryOpen(open: boolean): void {
  writeOptionalStorage(
    MATCHMAKING_HISTORY_OPEN_STORAGE_KEY,
    open ? "open" : "closed",
  );
}

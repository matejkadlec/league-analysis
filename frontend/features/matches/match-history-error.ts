import { apiErrorMessage, type ApiError } from "@/lib/core/http/api";

const DEFAULT_MATCH_HISTORY_ERROR =
  "Match history could not be loaded. Please try again later.";

export function getMatchHistoryErrorMessage(error: ApiError): string {
  // `apiErrorMessage` falls back for these kinds, but the normalized wording
  // is already viewer-safe and says more than the generic sentence.
  if (error.kind === "network" || error.kind === "timeout") {
    return error.message;
  }

  return apiErrorMessage(error, DEFAULT_MATCH_HISTORY_ERROR);
}

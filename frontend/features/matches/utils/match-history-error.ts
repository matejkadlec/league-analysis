const DEFAULT_MATCH_HISTORY_ERROR = "Failed to load matches";
const SERVICE_CONNECTION_ERROR =
  "Unable to reach the League Analysis service. Please retry. If the problem continues, check that the backend is running.";

function responseErrorMessage(responseError: unknown): string | null {
  if (typeof responseError === "string") {
    return responseError;
  }

  if (
    typeof responseError === "object" &&
    responseError !== null &&
    "message" in responseError &&
    typeof responseError.message === "string"
  ) {
    return responseError.message;
  }

  return null;
}

export function getMatchHistoryErrorMessage(
  error: unknown,
  responseError: unknown,
): string {
  const message =
    error instanceof Error
      ? error.message
      : (responseErrorMessage(responseError) ?? DEFAULT_MATCH_HISTORY_ERROR);

  if (message.includes("Network Error") || message.includes("ERR_NETWORK")) {
    return SERVICE_CONNECTION_ERROR;
  }

  return message;
}

import { api } from "@/lib/core/http/api";

/** The prefix the axios client mounts every route under, spelled once. */
const API_PREFIX = "/api/v1";

/**
 * Absolute because a node-environment suite has no page to resolve a relative
 * `msw` handler against; same-origin instead once jsdom supplies one.
 */
export function apiRoute(path: string): string {
  const origin =
    typeof window === "undefined"
      ? new URL(api.defaults.baseURL ?? "").origin
      : window.location.origin;
  return `${origin}${API_PREFIX}${path}`;
}

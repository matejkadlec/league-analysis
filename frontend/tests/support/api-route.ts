import { api } from "@/lib/core/http/api";

/** The prefix the axios client mounts every route under, spelled once. */
const API_PREFIX = "/api/v1";

/**
 * The absolute URL one API route is served at, `msw` path parameters intact.
 * Absolute because a node-environment suite has no page to resolve a relative
 * handler against, and same-origin only when jsdom supplies one.
 */
export function apiRoute(path: string): string {
  const origin =
    typeof window === "undefined"
      ? new URL(api.defaults.baseURL ?? "").origin
      : window.location.origin;
  return `${origin}${API_PREFIX}${path}`;
}

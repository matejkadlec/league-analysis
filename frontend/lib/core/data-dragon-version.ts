import { DDRAGON_FALLBACK_VERSION } from "./data-dragon";

const VERSION_MANIFEST_URL =
  "https://ddragon.leagueoflegends.com/api/versions.json";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export async function resolveDDragonVersion(
  fetchVersionManifest: typeof fetch = fetch,
): Promise<string> {
  try {
    const response = await fetchVersionManifest(VERSION_MANIFEST_URL, {
      next: { revalidate: 6 * 60 * 60 },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      // Server-side module: a silent fallback here would leave every asset on
      // a pinned version for weeks with no trace in the container log.
      console.error("Data Dragon version manifest unavailable; using fallback", {
        stage: "http-error",
        status: response.status,
        fallbackVersion: DDRAGON_FALLBACK_VERSION,
      });
      return DDRAGON_FALLBACK_VERSION;
    }

    const versions: unknown = await response.json();
    const latest = Array.isArray(versions) ? versions[0] : null;
    if (typeof latest === "string" && VERSION_PATTERN.test(latest)) {
      return latest;
    }

    console.error("Data Dragon version manifest invalid; using fallback", {
      stage: "invalid-manifest",
      fallbackVersion: DDRAGON_FALLBACK_VERSION,
    });
    return DDRAGON_FALLBACK_VERSION;
  } catch (error) {
    console.error("Data Dragon version manifest fetch failed; using fallback", {
      stage: "fetch-failed",
      message: error instanceof Error ? error.message : String(error),
      fallbackVersion: DDRAGON_FALLBACK_VERSION,
    });
    return DDRAGON_FALLBACK_VERSION;
  }
}

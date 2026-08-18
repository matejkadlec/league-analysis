import { DDRAGON_FALLBACK_VERSION } from "./data-dragon";

const VERSION_MANIFEST_URL =
  "https://ddragon.leagueoflegends.com/api/versions.json";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Resolve the Data Dragon version every asset URL is built from.
 *
 * The root layout awaits this, and most player routes prerender, so for those
 * the answer is baked into the static payload at build time and changes on
 * deploy rather than on any schedule — verified by reading `ddragonVersion`
 * back out of `.next/server/app/*.rsc` and out of the running production
 * container. The `revalidate` below therefore only governs the routes that
 * stay dynamic. That is fine in practice: Data Dragon keeps old versions
 * served, this repository releases per commit, and Riot patches fortnightly.
 */
export async function resolveDDragonVersion(
  fetchVersionManifest: typeof fetch = fetch,
): Promise<string> {
  // An explicit pin skips the network entirely: it is how a bad upstream
  // release is held back without a deploy, and how the end-to-end suite keeps
  // Riot's CDN out of the gate and its icon URLs stable from run to run. A
  // malformed value is ignored rather than obeyed, so a typo cannot point
  // every asset at a version that does not exist.
  const pinned = process.env.DDRAGON_VERSION;
  if (pinned && VERSION_PATTERN.test(pinned)) {
    return pinned;
  }
  if (pinned) {
    console.error("DDRAGON_VERSION is not a version number; ignoring it", {
      pinned,
    });
  }

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

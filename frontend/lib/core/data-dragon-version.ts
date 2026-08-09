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
      return DDRAGON_FALLBACK_VERSION;
    }

    const versions: unknown = await response.json();
    const latest = Array.isArray(versions) ? versions[0] : null;
    return typeof latest === "string" && VERSION_PATTERN.test(latest)
      ? latest
      : DDRAGON_FALLBACK_VERSION;
  } catch {
    return DDRAGON_FALLBACK_VERSION;
  }
}

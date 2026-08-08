import { describe, expect, it, vi } from "vitest";
import {
  DDRAGON_FALLBACK_VERSION,
  getChampionIconUrl,
  getProfileIconFallbackUrl,
  getRuneStyleIconUrl,
  getSummonerSpellIconUrlById,
} from "@/lib/core/data-dragon";
import { resolveDDragonVersion } from "@/lib/core/data-dragon-version";

describe("Data Dragon version resolution", () => {
  it("uses Riot's latest valid manifest version", async () => {
    const fetchManifest = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(["99.1.2", "99.1.1"]), { status: 200 }),
    );

    await expect(
      resolveDDragonVersion(fetchManifest as typeof fetch),
    ).resolves.toBe("99.1.2");
  });

  it("falls back safely for failed or malformed manifests", async () => {
    const failed = vi.fn().mockRejectedValue(new Error("offline"));
    const malformed = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(["not-a-version"])));

    await expect(resolveDDragonVersion(failed as typeof fetch)).resolves.toBe(
      DDRAGON_FALLBACK_VERSION,
    );
    await expect(
      resolveDDragonVersion(malformed as typeof fetch),
    ).resolves.toBe(DDRAGON_FALLBACK_VERSION);
  });
});

describe("Data Dragon asset URLs", () => {
  it("uses the runtime version for versioned assets and fallback icons", () => {
    expect(getChampionIconUrl("Annie", "99.1.2")).toContain(
      "/cdn/99.1.2/img/champion/Annie.png",
    );
    expect(getProfileIconFallbackUrl(999999, "99.1.2")).toContain(
      "/cdn/99.1.2/img/profileicon/29.png",
    );
    expect(getSummonerSpellIconUrlById(4, "99.1.2")).toContain(
      "/cdn/99.1.2/img/spell/SummonerFlash.png",
    );
  });

  it("keeps unknown spell and rune IDs non-renderable", () => {
    expect(getSummonerSpellIconUrlById(999999, "99.1.2")).toBeNull();
    expect(getRuneStyleIconUrl(999999)).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DDRAGON_FALLBACK_VERSION,
  getChampionIconUrl,
  getKeystoneIconUrlById,
  getKeystoneName,
  getProfileIconFallbackUrl,
  getRuneStyleIconUrl,
  getSummonerSpellIconUrlById,
  getSummonerSpellName,
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

  it("honours a well-formed DDRAGON_VERSION pin without asking Riot", async () => {
    vi.stubEnv("DDRAGON_VERSION", "12.34.5");
    const fetchManifest = vi.fn();

    await expect(
      resolveDDragonVersion(fetchManifest as unknown as typeof fetch),
    ).resolves.toBe("12.34.5");
    expect(fetchManifest).not.toHaveBeenCalled();
  });

  it("ignores a malformed DDRAGON_VERSION pin rather than serving it", async () => {
    vi.stubEnv("DDRAGON_VERSION", "latest");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchManifest = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(["99.1.2"])));

    await expect(
      resolveDDragonVersion(fetchManifest as typeof fetch),
    ).resolves.toBe("99.1.2");
    expect(consoleError).toHaveBeenCalledWith(
      "DDRAGON_VERSION is not a version number; ignoring it",
      { pinned: "latest" },
    );
    consoleError.mockRestore();
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

describe("Data Dragon version fallback reporting", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleError.mockRestore();
  });

  it("records every fallback branch with its stage and fallback version", async () => {
    consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
    );
    await expect(resolveDDragonVersion()).resolves.toBe(
      DDRAGON_FALLBACK_VERSION,
    );
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "Data Dragon version manifest unavailable; using fallback",
      { stage: "http-error", status: 503, fallbackVersion: DDRAGON_FALLBACK_VERSION },
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(["not-a-version"]))),
    );
    await expect(resolveDDragonVersion()).resolves.toBe(
      DDRAGON_FALLBACK_VERSION,
    );
    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenLastCalledWith(
      "Data Dragon version manifest invalid; using fallback",
      { stage: "invalid-manifest", fallbackVersion: DDRAGON_FALLBACK_VERSION },
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND")),
    );
    await expect(resolveDDragonVersion()).resolves.toBe(
      DDRAGON_FALLBACK_VERSION,
    );
    expect(consoleError).toHaveBeenCalledTimes(3);
    expect(consoleError).toHaveBeenLastCalledWith(
      "Data Dragon version manifest fetch failed; using fallback",
      {
        stage: "fetch-failed",
        message: "getaddrinfo ENOTFOUND",
        fallbackVersion: DDRAGON_FALLBACK_VERSION,
      },
    );
  });

  it("stays silent when the manifest resolves", async () => {
    consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(["99.1.2", "99.1.1"]))),
    );

    await expect(resolveDDragonVersion()).resolves.toBe("99.1.2");

    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("Data Dragon asset URLs", () => {
  it("uses the runtime version for versioned assets and fallback icons", () => {
    expect(getChampionIconUrl("Annie", "99.1.2")).toContain(
      "/cdn/99.1.2/img/champion/Annie.png",
    );
    expect(getProfileIconFallbackUrl("99.1.2")).toContain(
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

describe("Data Dragon display names", () => {
  it("names runes and spells the way the game does, not the way the CDN does", () => {
    // The asset filename is not the name: 8439 still ships as
    // `VeteranAftershock` and 8008 as `LethalTempoTemp`, while the game calls
    // them Aftershock and Lethal Tempo. A tooltip built from the path would
    // put a decade-old codename in front of the player.
    expect(getKeystoneName(8439)).toBe("Aftershock");
    expect(getKeystoneName(8008)).toBe("Lethal Tempo");
    expect(getKeystoneName(8005)).toBe("Press the Attack");
    expect(getSummonerSpellName(4)).toBe("Flash");
    expect(getSummonerSpellName(14)).toBe("Ignite");
  });

  it("has no name for an ID it has no icon for", () => {
    // The caller falls back on null, and the icon does too — an ID that
    // names a rune it cannot draw is how a label ends up disagreeing with the
    // picture next to it.
    expect(getKeystoneName(999999)).toBeNull();
    expect(getKeystoneIconUrlById(999999)).toBeNull();
    expect(getSummonerSpellName(999999)).toBeNull();
  });
});

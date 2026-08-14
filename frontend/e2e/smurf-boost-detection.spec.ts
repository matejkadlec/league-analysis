import { expect, test } from "@playwright/test";

const NOW = "2026-08-14T10:00:00.000Z";
const PUUID = "smurf-boost-player-puuid";

const player = {
  puuid: PUUID,
  game_name: "Comparison",
  tag_line: "ONE",
  platform: "eun1",
  is_tracked: true,
  analyzed_matches: 0,
  total_matches: 0,
  profile_synced_at: NOW,
  league_synced_at: NOW,
  match_synced_at: NOW,
  created_at: NOW,
  updated_at: NOW,
};

/** Words `docs/smurf-boost-detection.md` forbids in the rendered page. */
const FORBIDDEN = [
  "smurf detected",
  "likely boosted",
  "suspicious",
  "clean",
  "legitimate",
  "verified",
  "confirmed",
  "probability",
];

function signal(
  id: string,
  family: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    family,
    available: true,
    triggered: false,
    sample_size: 20,
    reason: `Measured area ${id}.`,
    notes: [],
    raw_value: 0.4,
    threshold: 1.2,
    saturation: 3,
    magnitude: 0,
    weight: 0.3,
    contribution: 0,
    ...overrides,
  };
}

const CONSERVATIVE = {
  recentWindowSize: 20,
  baselineWindowSize: 60,
  a1StepChangeThreshold: 1.2,
  a2WinRateSurgeThreshold: 0.2,
  a3NovelChampionThreshold: 1.2,
  a3MinimumNovelGames: 8,
  a4SummonerLevelGate: 45,
  a4PerformanceThreshold: 1.2,
  b1WinRateDeltaThreshold: 0.3,
  b1CompositeFlatCeiling: 0.05,
  b2ConsistencyShiftThreshold: 1.15,
  b3BimodalityThreshold: 0.65,
  b3TailFraction: 0.3,
  b4HighRateFloor: 0.62,
  b4DropThreshold: 0.2,
};

const SENSITIVE = {
  ...CONSERVATIVE,
  recentWindowSize: 15,
  baselineWindowSize: 30,
  a1StepChangeThreshold: 0.8,
  a2WinRateSurgeThreshold: 0.12,
  a3MinimumNovelGames: 5,
};

function cardPreferences(settings: Record<string, number>, isDefault: boolean) {
  return [
    // Top Champions carries a role list, so the shared settings shape is not
    // numeric-only. Getting that wrong rejects the whole catalog.
    {
      cardId: "profile.top-champions",
      version: 1,
      settings: { queueId: 420, displayLimit: 5, includedRoles: [] },
      isDefault: true,
      requiresRecovery: false,
      updatedAt: null,
    },
    {
      cardId: "profile.smurf-boost-detection",
      version: 1,
      settings: { queueId: 420, ...settings },
      isDefault,
      requiresRecovery: false,
      updatedAt: isDefault ? null : NOW,
    },
  ];
}

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    puuid: PUUID,
    created_at: NOW,
    status: "completed",
    model_version: "smurf-boost/v1",
    thresholds: { recent_window_size: 20, baseline_window_size: 60 },
    eligible_games: 240,
    latest_match_id: "EUN1_1",
    error_code: null,
    error_message: null,
    completed_at: NOW,
    is_stale: false,
    results: {
      model_version: "smurf-boost/v1",
      confidence: 0.86,
      confidence_band: "high",
      recent_games: 20,
      baseline_games: 60,
      eligible_games: 240,
      notes: ["patch_disjoint_windows"],
      disclaimer:
        "This is a statistical comparison of a player's recent ranked games against their own earlier games. It is not evidence of smurfing, boosting, or account sharing, and it cannot distinguish improvement from any other explanation. Do not use it to accuse anyone.",
      families: [
        {
          family: "rapid_improvement",
          band: "notable_indicators",
          distinct_evidence: 2,
          signals: [
            signal("A1", "rapid_improvement", {
              triggered: true,
              raw_value: 1.45,
            }),
            signal("A2", "rapid_improvement", {
              triggered: true,
              raw_value: 0.28,
              threshold: 0.2,
            }),
            signal("A3", "rapid_improvement", {
              available: false,
              raw_value: null,
              threshold: null,
              saturation: null,
              magnitude: null,
              contribution: null,
              sample_size: 0,
              reason: "No recent game was on a rarely played champion.",
              notes: ["insufficient_novel_sample"],
            }),
            signal("A4", "rapid_improvement"),
          ],
        },
        {
          family: "playing_pattern_change",
          band: "no_unusual_pattern",
          distinct_evidence: 0,
          signals: [
            signal("B1", "playing_pattern_change"),
            signal("B2", "playing_pattern_change"),
          ],
        },
      ],
    },
    ...overrides,
  };
}

test("runs a comparison and reports both families without accusing anyone", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });

  let analyzeCalls = 0;
  let stored: Record<string, unknown> | null = null;
  let thresholds: Record<string, number> = CONSERVATIVE;
  let isDefaultSettings = true;
  let written: Record<string, unknown> | null = null;

  await page.addInitScript(() => {
    localStorage.setItem("auth_access_token", "test-access-token");
    localStorage.setItem("auth_refresh_token", "test-refresh-token");
    localStorage.setItem("theme", "dark");
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path.endsWith("/auth/me")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: 7,
          email: "qa@example.test",
          display_name: "QA User",
          is_active: true,
          is_admin: false,
          email_verified: true,
          email_verified_at: NOW,
          last_login: NOW,
          riot_account_connected: false,
          puuid: null,
          created_at: NOW,
          updated_at: NOW,
        }),
      });
      return;
    }

    if (
      path.endsWith("/players/context") ||
      path.endsWith("/players/context/current")
    ) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          current_player: player,
          tracked_players: [player],
        }),
      });
      return;
    }

    if (path.endsWith(`/players/${PUUID}`)) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(player),
      });
      return;
    }

    if (path.endsWith("/smurf-boost-detection/presets")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          default_preset: "conservative",
          presets: [
            { name: "conservative", thresholds: CONSERVATIVE },
            { name: "sensitive", thresholds: SENSITIVE },
          ],
        }),
      });
      return;
    }

    if (path.endsWith("/settings/card-preferences")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(cardPreferences(thresholds, isDefaultSettings)),
      });
      return;
    }

    if (path.endsWith("/settings/card-preferences/profile.smurf-boost-detection")) {
      if (request.method() === "DELETE") {
        thresholds = CONSERVATIVE;
        isDefaultSettings = true;
      } else {
        written = request.postDataJSON() as Record<string, unknown>;
        thresholds = (written.settings ?? {}) as Record<string, number>;
        isDefaultSettings = false;
      }
      const catalog = cardPreferences(thresholds, isDefaultSettings);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(catalog[1]),
      });
      return;
    }

    if (path.endsWith("/smurf-boost-detection/analyze")) {
      analyzeCalls += 1;
      stored = analysis();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(stored),
      });
      return;
    }

    if (path.endsWith(`/smurf-boost-detection/player/${PUUID}`)) {
      if (stored === null) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ detail: "No analysis found for this player" }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(stored),
      });
      return;
    }

    if (
      path.endsWith("/settings/user/cookie-consent") &&
      request.method() === "PUT"
    ) {
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }

    await route.fulfill({ status: 404, body: "Not found" });
  });

  await page.goto("/player-overview");
  await page.getByRole("button", { name: "Accept necessary" }).click();

  // The sidebar entry keeps the selected player, like the other player pages.
  const navigationLink = page.getByRole("link", {
    name: "Smurf & Boost Detection",
  });
  await expect(navigationLink).toHaveAttribute(
    "href",
    `/smurf-boost-detection?puuid=${PUUID}`,
  );
  await navigationLink.click();
  await expect(page).toHaveURL(
    new RegExp(`/smurf-boost-detection\\?puuid=${PUUID}`),
  );

  await expect(page.locator("#smurf-boost-explanation")).toBeVisible();
  await expect(page.locator("#smurf-boost-settings")).toBeVisible();

  // The stored settings match the shipped preset, and every threshold is
  // offered with the range the backend enforces.
  const settingsCard = page.locator("#smurf-boost-settings");
  await expect(settingsCard.getByText("Shipped defaults")).toBeVisible();
  await expect(
    page.getByTestId("smurf-boost-preset-conservative"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Recent games compared")).toHaveValue("20");
  await expect(page.getByText("Allowed: 10 to 50.")).toBeVisible();

  // A value the backend would reject never reaches it.
  await page.getByLabel("B3 share counted as a tail").fill("0.9");
  await expect(
    page.getByText("B3 share counted as a tail must be between 0.15 and 0.4."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save thresholds" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Discard changes" }).click();

  // Applying a preset sends only the fields the write contract accepts.
  await page.getByTestId("smurf-boost-preset-sensitive").click();
  await expect(settingsCard.getByText("Your settings")).toBeVisible();
  await expect(page.getByLabel("Recent games compared")).toHaveValue("15");
  // `written` is filled inside the route handler, which the checker cannot see.
  const writtenBody = written as unknown as {
    settings: Record<string, unknown>;
  } | null;
  expect(writtenBody).not.toBeNull();
  expect(writtenBody?.settings.queueId).toBeUndefined();
  expect(Object.keys(writtenBody?.settings ?? {}).length).toBe(15);

  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(settingsCard.getByText("Shipped defaults")).toBeVisible();
  await expect(page.getByLabel("Recent games compared")).toHaveValue("20");

  await expect(page.locator("#smurf-boost-run")).toBeVisible();
  await expect(page.locator("#smurf-boost-result")).toHaveCount(0);

  await page.getByRole("button", { name: "Run the comparison" }).click();

  const result = page.locator("#smurf-boost-result");
  await expect(result).toBeVisible();
  expect(analyzeCalls).toBe(1);

  // Each family carries its own band, and neither is summarised as a number.
  await expect(result.getByText("Rapid improvement pattern")).toBeVisible();
  await expect(result.getByText("Notable indicators")).toBeVisible();
  await expect(result.getByText("Playing pattern change")).toBeVisible();
  await expect(result.getByText("No unusual pattern")).toBeVisible();
  await expect(result.getByText("High confidence")).toBeVisible();

  // An area that could not be measured stays visible with its reason.
  await expect(result.getByText("Not available")).toBeVisible();
  await expect(
    result.getByText("No recent game was on a rarely played champion."),
  ).toBeVisible();

  await expect(
    result.getByText("Do not use it to accuse anyone.", { exact: false }),
  ).toBeVisible();

  const pageText = (await page.locator("body").innerText()).toLowerCase();
  for (const word of FORBIDDEN) {
    expect(pageText, `page must not contain "${word}"`).not.toContain(word);
  }

  // A family reading is a word, never a number. A win rate inside a signal row
  // may still be a percentage, so the digit check is scoped to the band.
  const bands = page.locator("[data-testid^='smurf-boost-band-']");
  await expect(bands).toHaveCount(2);
  for (const band of await bands.all()) {
    expect(await band.innerText()).not.toMatch(/\d/);
  }

  // The stored result is read back on a fresh visit rather than re-run.
  await page.reload();
  await expect(page.locator("#smurf-boost-result")).toBeVisible();
  expect(analyzeCalls).toBe(1);
  await expect(
    page.getByRole("button", { name: "Run the comparison again" }),
  ).toBeVisible();
});

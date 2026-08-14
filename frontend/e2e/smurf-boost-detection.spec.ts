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

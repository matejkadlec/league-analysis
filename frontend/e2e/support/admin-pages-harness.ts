import { expect, type Page } from "@playwright/test";

import { acceptCookieBanner, seedAuthenticatedSession } from "./auth";
import { qaUser } from "./fixtures";
import { blockUpstreamRequests } from "./offline";

/**
 * The two administrator pages, Jobs and Settings, with every card they show
 * populated: both job cards with a last run, and a stored Riot API key.
 */

const NOW = "2026-08-14T10:00:00.000Z";

const job = (
  id: number,
  jobType: string,
  name: string,
  description: string,
) => ({
  id,
  job_type: jobType,
  name,
  description,
  schedule: "interval",
  interval_seconds: 3600 * id,
  is_active: true,
  is_paused: false,
  is_running: false,
  config_json: null,
  created_at: NOW,
  updated_at: NOW,
});

const JOBS = [
  job(
    1,
    "MATCH_FETCHER",
    "Match Fetcher",
    "Fetches new ranked matches for every tracked player.",
  ),
  job(
    2,
    "PLAYER_UPDATER",
    "Player Updater",
    "Refreshes profile and rank data for every tracked player.",
  ),
];

const execution = (id: number, jobId: number) => ({
  id,
  job_config_id: jobId,
  started_at: NOW,
  completed_at: NOW,
  status: "SUCCESS",
  api_requests_made: 42,
  records_created: 7,
  records_updated: 3,
  triggered_by: "system",
  execution_type: "REGULAR",
});

const page1 = <T>(items: T[]) => ({
  executions: items,
  total: items.length,
  page: 1,
  size: 20,
  pages: 1,
});

async function installAdminPagesMocks(page: Page): Promise<void> {
  await seedAuthenticatedSession(page);
  await blockUpstreamRequests(page);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path.endsWith("/auth/me")) {
      return json(qaUser(NOW, { is_admin: true }));
    }
    if (
      path.endsWith("/players/context") ||
      path.endsWith("/players/context/current")
    ) {
      return json({ current_player: null, tracked_players: [] });
    }
    if (path.endsWith("/players/tracked/list")) {
      return json([]);
    }
    if (path.endsWith("/jobs/")) {
      return json(JOBS);
    }
    if (path.endsWith("/jobs/status/overview")) {
      return json({
        scheduler_running: true,
        active_jobs: JOBS.length,
        running_executions: 0,
        last_execution: execution(9, 1),
        next_run_time: NOW,
      });
    }
    if (path.endsWith("/jobs/executions/all")) {
      return json(page1([execution(9, 1), execution(8, 2)]));
    }
    const jobExecutions = /\/jobs\/(\d+)\/executions$/.exec(path);
    if (jobExecutions) {
      const jobId = Number(jobExecutions[1]);
      return json(page1([execution(jobId * 10, jobId)]));
    }
    if (path.endsWith("/settings/riot_api_key")) {
      return json({
        key: "riot_api_key",
        masked_value: "RGAPI-****-****-1234",
        category: "riot",
        is_sensitive: true,
        created_at: NOW,
        updated_at: NOW,
      });
    }
    if (path.endsWith("/settings/service-status")) {
      return json({
        is_under_maintenance: false,
        reason: "ok",
        credential_status: "valid",
        health_revision: 3,
        observed_at: NOW,
        has_recent_recovery: false,
        recovery_notice_key: null,
      });
    }
    if (path.endsWith("/settings/user/cookie-consent")) {
      return json({});
    }
    return route.fulfill({ status: 404, body: "Not found" });
  });
}

/** Each administrator page with a `ready` selector only its content renders. */
export const ADMIN_ROUTES = [
  {
    name: "jobs",
    route: "/jobs",
    ready: "text=Player Updater",
  },
  {
    name: "settings",
    route: "/settings",
    ready: "text=RGAPI-****-****-1234",
  },
] as const;

export type AdminRoute = (typeof ADMIN_ROUTES)[number];

export async function gotoAdminRoute(
  page: Page,
  route: AdminRoute,
): Promise<void> {
  await installAdminPagesMocks(page);
  await page.goto(route.route);
  await acceptCookieBanner(page);
  await expect(page.locator(route.ready).first()).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
}

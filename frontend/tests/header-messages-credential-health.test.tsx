// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";

import { renderWithQueryClient } from "./support/render-support";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isAdmin: true,
  serviceStatus: {
    is_under_maintenance: true,
    reason: "api_key_invalid" as const,
    credential_status: "invalid" as const,
    health_revision: 7,
    observed_at: "2026-08-11T20:00:00Z",
    has_recent_recovery: false,
    recovery_notice_key: null,
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/players",
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({
    user: { id: 9, is_admin: state.isAdmin },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// Spread, not a literal: a factory listing exports by hand drops every one
// the module gains, and the reader that needed a storage key was throwing
// inside a `try` that answered with the empty default.
vi.mock("@/features/cookie-consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/cookie-consent")>()),
  COOKIE_CONSENT_UPDATED_EVENT: "cookie-consent-updated",
  canUseOptionalStorage: () => false,
}));

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedGet: vi
    .fn<typeof import("@/lib/core/http/api").validatedGet>()
    .mockImplementation(async () => ({
      success: true,
      data: state.serviceStatus,
    })),
}));

import { HeaderMessages } from "@/components/header-messages";

function renderHeader() {
  renderWithQueryClient(
    <HeaderMessages />,
  );
}

describe("HeaderMessages credential health", () => {
  beforeEach(() => {
    state.isAdmin = true;
  });


  it("projects the same invalid backend state for admin and non-admin users", async () => {
    renderHeader();
    expect(await screen.findByText(/Riot API Key is invalid or expired/)).toBeTruthy();

    cleanup();
    state.isAdmin = false;
    renderHeader();
    expect(await screen.findByText(/Application is under maintenance/)).toBeTruthy();
  });

  it("restores an invalid warning from server state after a remount", async () => {
    renderHeader();
    expect(await screen.findByText(/Riot API Key is invalid or expired/)).toBeTruthy();

    cleanup();
    renderHeader();
    expect(await screen.findByText(/Riot API Key is invalid or expired/)).toBeTruthy();
  });
});

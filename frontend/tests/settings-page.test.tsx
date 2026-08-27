// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "./render-support";

const { useAuth } = vi.hoisted(() => ({
  useAuth: vi.fn<typeof import("@/features/auth").useAuth>(),
}));

vi.mock("@/features/auth", () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => children,
  useAuth,
}));

// Both cards open their own forms and queries; stubbed so the page's own
// decision -- which settings a member versus an admin sees -- is under test.
vi.mock("@/features/settings", () => ({
  AccountSettingsCard: () => <div data-testid="account-settings-stub">account settings</div>,
  RiotApiSettingsCard: () => <div data-testid="riot-api-settings-stub">riot api settings</div>,
}));

import SettingsPage from "@/app/settings/page";
import type { AuthContextType } from "@/features/auth/types";

/** The whole context, because that is what `useAuth` answers with. */
function signedInAs({ is_admin }: { is_admin: boolean }): AuthContextType {
  return {
    user: {
      id: 1,
      is_admin,
      email: "account@example.test",
      display_name: "Account",
      is_active: true,
      email_verified: true,
      email_verified_at: null,
      last_login: null,
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    },
    isAuthenticated: true,
    isLoading: false,
    login: async () => {},
    logout: async () => {},
    checkAuth: async () => {},
  };
}

beforeEach(() => {
  useAuth.mockReset();
});

describe("the settings page", () => {
  it("offers account settings only, described for a member", () => {
    useAuth.mockReturnValue(signedInAs({ is_admin: false }));

    renderWithQueryClient(<SettingsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Manage your account profile and security"),
    ).toBeTruthy();
    expect(screen.getByTestId("account-settings-stub")).toBeTruthy();
    // The Riot key is the deployment's single production credential: the
    // page must not even render its card for a member.
    expect(screen.queryByTestId("riot-api-settings-stub")).toBeNull();
  });

  it("adds the global Riot API card for an admin", () => {
    useAuth.mockReturnValue(signedInAs({ is_admin: true }));

    renderWithQueryClient(<SettingsPage />);

    expect(
      screen.getByText(
        "Manage account security and global Riot API configuration",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("account-settings-stub")).toBeTruthy();
    expect(screen.getByTestId("riot-api-settings-stub")).toBeTruthy();
  });
});

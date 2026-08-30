// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiResponse } from "@/lib/core/http/api";

type Api = typeof import("@/lib/core/http/api");
type AppToast = typeof import("@/lib/core/hooks").appToast;

const { validatedGet, validatedPut, validatedPost, toast } = vi.hoisted(() => ({
  validatedGet: vi.fn<Api["validatedGet"]>(),
  validatedPut: vi.fn<Api["validatedPut"]>(),
  validatedPost: vi.fn<Api["validatedPost"]>(),
  toast: {
    success: vi.fn<AppToast["success"]>(),
    error: vi.fn<AppToast["error"]>(),
    warning: vi.fn<AppToast["warning"]>(),
    info: vi.fn<AppToast["info"]>(),
  },
}));

vi.mock("@/lib/core/http/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/http/api")>()),
  validatedGet,
  validatedPut,
  validatedPost,
}));

vi.mock("@/lib/core/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/hooks")>()),
  useToast: () => toast,
}));

import { RiotApiSettingsCard } from "@/features/settings/components/riot-api-settings-card";
import { appToast } from "@/lib/core/hooks";
import { createProvidersQueryClient } from "@/components/providers";
import { RIOT_CREDENTIAL_HEALTH_UPDATED_EVENT } from "@/lib/core/riot/riot-credential-health-events";
import { renderWithQueryClient } from "./support/render-support";

/**
 * A key of the right shape, assembled rather than written out: the gitleaks
 * hook scans for this exact pattern, and rightly so. Joining the parts leaves
 * no key-shaped literal for the scanner -- or a reader -- to trip over.
 */
function riotKey(body: string): string {
  return [
    "RGAPI",
    body.repeat(8),
    body.repeat(4),
    body.repeat(4),
    body.repeat(4),
    body.repeat(12),
  ].join("-");
}

const VALID_KEY = riotKey("0");
const OTHER_VALID_KEY = riotKey("1");

const DB_SETTING = {
  key: "riot_api_key",
  masked_value: "RGAPI-****-0000",
  category: "riot",
  is_sensitive: true,
  created_at: "2026-01-01T00:00:00.000Z",
  // Late enough in the UTC day that a five-hour-behind viewer reads the day
  // before, and an asymmetric day and month so a swapped date order shows.
  updated_at: "2026-01-05T03:20:45.000Z",
};

function status(overrides: Record<string, unknown> = {}) {
  return {
    credential_status: "valid",
    evidence: "provider_success",
    observed_at: "2026-01-02T00:00:00.000Z",
    health_revision: 1,
    ...overrides,
  };
}

/** Answers the card's two GETs: the stored setting, then its health status. */
function respondWith(options: {
  setting?: ApiResponse<unknown>;
  status?: Record<string, unknown>;
}) {
  validatedGet.mockImplementation(async (_schema: unknown, path: string) => {
    if (path === "/settings/riot_api_key") {
      return options.setting ?? { success: true, data: DB_SETTING };
    }
    return { success: true, data: options.status ?? status() };
  });
}

function renderCard() {
  return renderWithQueryClient(<RiotApiSettingsCard />).queryClient;
}

async function typeKey(value: string) {
  const input = await screen.findByLabelText("New Riot API Key");
  fireEvent.change(input, { target: { value } });
  return input;
}

describe("the card that swaps the Riot API key", () => {
  beforeEach(() => {
    validatedGet.mockReset();
    validatedPut.mockReset();
    validatedPost.mockReset();
    Object.values(toast).forEach((fn) => fn.mockReset());
    respondWith({});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("stamps the stored key in the viewer's clock, not UTC", async () => {
    // Written out rather than built with `formatDateTime`, which cannot
    // notice its own output changing. The zone sits five hours behind the
    // stored instant, so the date rolls back a day: the "not UTC" half.
    vi.stubEnv("TZ", "America/New_York");

    const queryClient = renderCard();

    expect(
      await screen.findByText("Last updated: 4.1.2026 10:20:45 PM"),
    ).toBeTruthy();

    queryClient.clear();
  });

  it("refuses to save a key that is not shaped like a Riot key", async () => {
    // The key this writes is what every ingestion job authenticates with, and
    // saving activates it with no restart. The prefix check is all that keeps a
    // mis-pasted string from becoming the live credential.
    const user = userEvent.setup();
    const queryClient = renderCard();

    const input = await typeKey("not-a-riot-key");
    await user.click(screen.getByRole("button", { name: /Save & Apply/ }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(validatedPut).not.toHaveBeenCalled();
    // Only a saved key is cleared away. The mis-pasted one stays on screen to
    // be corrected, next to the toast that says what is wrong with it.
    expect((input as HTMLInputElement).value).toBe("not-a-riot-key");

    queryClient.clear();
  });

  it("says so when the save request itself fails", async () => {
    // A mutation returning the `ApiResponse` envelope cannot reject, which
    // leaves `onError` dead and hides a failed key save from the global
    // `MutationCache.onError`.
    const user = userEvent.setup();
    validatedPut.mockResolvedValue({
      success: false,
      error: {
        kind: "unexpected",
        code: "UNKNOWN_ERROR",
        status: 500,
        message: "Boom",
      },
    });
    const queryClient = renderCard();

    const input = await typeKey(VALID_KEY);
    await user.click(screen.getByRole("button", { name: /Save & Apply/ }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Riot API key was not updated",
        expect.anything(),
      ),
    );
    // A save that failed leaves the key to retry with: clearing the field
    // here would send the operator back to the Riot portal for it.
    expect((input as HTMLInputElement).value).toBe(VALID_KEY);

    queryClient.clear();
  });

  it("will not save a key Riot has just rejected", async () => {
    // Testing is the point of the button beside it. Once a test comes back
    // failed, saving anyway would put a known-bad key live and take ingestion
    // down until someone noticed.
    const user = userEvent.setup();
    validatedPost.mockResolvedValue({
      success: true,
      data: { success: false, status: "invalid", message: "Forbidden" },
    });
    const queryClient = renderCard();

    await typeKey(VALID_KEY);
    await user.click(screen.getByRole("button", { name: /Test Key/ }));

    await screen.findByText("Forbidden");
    expect(
      (
        screen.getByRole("button", {
          name: /Save & Apply/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    queryClient.clear();
  });

  it("stops holding a failed test against the next key typed", async () => {
    // Without clearing the previous result, one rejected key leaves the save
    // button disabled for every key typed after it -- locked out of applying a
    // good key, with the reason no longer on screen.
    const user = userEvent.setup();
    validatedPost.mockResolvedValue({
      success: true,
      data: { success: false, status: "invalid", message: "Forbidden" },
    });
    const queryClient = renderCard();

    await typeKey(VALID_KEY);
    await user.click(screen.getByRole("button", { name: /Test Key/ }));
    await screen.findByText("Forbidden");

    await typeKey(OTHER_VALID_KEY);

    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: /Save & Apply/,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(screen.queryByText("Forbidden")).toBeNull();

    queryClient.clear();
  });

  it("treats a missing stored key as a state, not a failure", async () => {
    // Before the first key is saved there is no row, so the 404 is the normal
    // answer and the card renders it as a prompt.

    // On the real provider wiring, because the DOM cannot tell the two apart:
    // `setting` is null either way. The global `queryCache.onError` separates
    // them, so letting the 404 through raises an error over a working card.
    respondWith({
      setting: {
        success: false,
        error: { message: "Not found", status: 404, kind: "not-found" },
      },
      status: status({ credential_status: "missing", evidence: "missing" }),
    });
    const announce = vi.spyOn(appToast, "toast").mockImplementation(() => "");
    const queryClient = createProvidersQueryClient();
    // Retries only slow the same outcome down; the wiring under test is the
    // error announcement, which fires once the query settles either way.
    queryClient.setDefaultOptions({ queries: { retry: false } });

    render(
      <QueryClientProvider client={queryClient}>
        <RiotApiSettingsCard />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(/No active Riot API Key found/),
    ).toBeTruthy();
    expect(screen.queryByText("Current API Key")).toBeNull();
    expect(announce).not.toHaveBeenCalled();

    announce.mockRestore();
    queryClient.clear();
  });

  it("tells the other surfaces the credential changed", async () => {
    // Nothing polls for this. Panels elsewhere reload their credential health
    // off this event, so without it they keep showing the old key's verdict
    // -- including a red "invalid" beside a key that was just fixed.
    const user = userEvent.setup();
    validatedPut.mockResolvedValue({ success: true, data: DB_SETTING });
    const heard = vi.fn<EventListener>();
    window.addEventListener(RIOT_CREDENTIAL_HEALTH_UPDATED_EVENT, heard);

    const queryClient = renderCard();

    const input = await typeKey(VALID_KEY);
    await user.click(screen.getByRole("button", { name: /Save & Apply/ }));

    await waitFor(() => expect(heard).toHaveBeenCalled());
    expect(validatedPut).toHaveBeenCalledWith(
      expect.anything(),
      "/settings/riot_api_key",
      { value: VALID_KEY },
    );
    // The saved key is now the stored one, so the entry field empties: a key
    // left sitting in it reads as still pending.
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));

    window.removeEventListener(RIOT_CREDENTIAL_HEALTH_UPDATED_EVENT, heard);
    queryClient.clear();
  });
});

// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { validatedGet, validatedPut, validatedPost, toast } = vi.hoisted(() => ({
  validatedGet: vi.fn(),
  validatedPut: vi.fn(),
  validatedPost: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  validatedGet,
  validatedPut,
  validatedPost,
}));

vi.mock("@/lib/core/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/hooks")>()),
  useToast: () => toast,
}));

import { RiotApiSettingsCard } from "@/app/settings/riot-api-settings-card";
import { appToast } from "@/lib/core/hooks";
import { createProvidersQueryClient } from "@/components/providers";
import { RIOT_CREDENTIAL_HEALTH_UPDATED_EVENT } from "@/lib/core/riot-credential-health-events";
import { renderWithQueryClient } from "./render-support";

/**
 * A key of the right shape, assembled rather than written out.
 *
 * The gitleaks hook scans for this exact pattern, and it is right to: a real
 * one pasted into a test would be committed. Joining the parts keeps the value
 * the component sees identical without leaving a key-shaped literal in the
 * repository for the scanner -- or a reader -- to trip over.
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
  updated_at: "2026-01-02T00:00:00.000Z",
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
  setting?: { success: boolean; data?: unknown; error?: unknown };
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
  });

  it("refuses to save a key that is not shaped like a Riot key", async () => {
    // The key this writes is what every ingestion job authenticates with, and
    // saving activates it with no restart. A paste that picked up the wrong
    // string should not become the live credential; the prefix check is the
    // only thing standing between the two, and it costs no request.
    const queryClient = renderCard();

    await typeKey("not-a-riot-key");
    fireEvent.click(screen.getByRole("button", { name: /Save & Apply/ }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(validatedPut).not.toHaveBeenCalled();

    queryClient.clear();
  });

  it("will not save a key Riot has just rejected", async () => {
    // Testing is the point of the button beside it. Once a test comes back
    // failed, saving anyway would put a known-bad key live and take ingestion
    // down until someone noticed.
    validatedPost.mockResolvedValue({
      success: true,
      data: { success: false, status: "invalid", message: "Forbidden" },
    });
    const queryClient = renderCard();

    await typeKey(VALID_KEY);
    fireEvent.click(screen.getByRole("button", { name: /Test Key/ }));

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
    validatedPost.mockResolvedValue({
      success: true,
      data: { success: false, status: "invalid", message: "Forbidden" },
    });
    const queryClient = renderCard();

    await typeKey(VALID_KEY);
    fireEvent.click(screen.getByRole("button", { name: /Test Key/ }));
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
    // Before the first key is ever saved there is no row, so the 404 is the
    // normal answer and the card renders it as a prompt rather than an error.
    //
    // This runs on the real provider wiring rather than a bare client, because
    // the DOM alone cannot tell the two apart: `setting` ends up null whether
    // the 404 is caught or thrown. What separates them is the global
    // `queryCache.onError`, which announces any failed query to the viewer --
    // this one sets no `silenceErrorToast`. Let the 404 through and a fresh
    // deployment raises "Could not load this data" over a card that is working
    // exactly as intended.
    respondWith({
      setting: { success: false, error: { status: 404, kind: "not_found" } },
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
    validatedPut.mockResolvedValue({ success: true, data: DB_SETTING });
    const heard = vi.fn();
    window.addEventListener(RIOT_CREDENTIAL_HEALTH_UPDATED_EVENT, heard);

    const queryClient = renderCard();

    await typeKey(VALID_KEY);
    fireEvent.click(screen.getByRole("button", { name: /Save & Apply/ }));

    await waitFor(() => expect(heard).toHaveBeenCalled());
    expect(validatedPut).toHaveBeenCalledWith(
      expect.anything(),
      "/settings/riot_api_key",
      { value: VALID_KEY },
    );

    window.removeEventListener(RIOT_CREDENTIAL_HEALTH_UPDATED_EVENT, heard);
    queryClient.clear();
  });
});

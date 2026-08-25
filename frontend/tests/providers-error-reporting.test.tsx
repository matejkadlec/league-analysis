// @vitest-environment jsdom

import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reportApiError, sonnerToast } = vi.hoisted(() => ({
  reportApiError: vi.fn(),
  sonnerToast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/core/api-error-logging", () => ({ reportApiError }));

vi.mock("sonner", () => ({ toast: sonnerToast }));

import { createProvidersQueryClient } from "../components/providers";

function httpError(status: number): AxiosError {
  const headers = new AxiosHeaders();
  const response: AxiosResponse = {
    data: {},
    status,
    statusText: "",
    headers,
    config: { headers },
  };
  return new AxiosError(
    `Request failed with status code ${status}`,
    String(status),
    { headers },
    {},
    response,
  );
}

describe("provider cache error reporting", () => {
  beforeEach(() => {
    reportApiError.mockReset();
    Object.values(sonnerToast).forEach((mock) => mock.mockReset());
  });

  it("reports a failed query in addition to its toast policy", async () => {
    const queryClient = createProvidersQueryClient();

    await expect(
      queryClient.fetchQuery({
        queryKey: ["players", "puuid-1"],
        queryFn: () => Promise.reject(new Error("query boom")),
        retry: false,
      }),
    ).rejects.toThrow("query boom");

    expect(reportApiError).toHaveBeenCalledTimes(1);
    const reportedError = reportApiError.mock.calls[0]?.[0];
    const queryContext = reportApiError.mock.calls[0]?.[1];
    expect(reportedError).toMatchObject({
      kind: "unexpected",
      message: "The request could not be completed. Please try again later.",
    });
    expect(queryContext).toEqual({
      source: "query",
      key: '["players","puuid-1"]',
    });

    expect(sonnerToast.error).toHaveBeenCalledWith(
      "Could not load this data",
      expect.objectContaining({ id: "query-error:unexpected" }),
    );

    queryClient.clear();
  });

  it("reports a failed mutation without announcing a second toast", async () => {
    const queryClient = createProvidersQueryClient();
    const observer = new MutationObserver(queryClient, {
      mutationFn: () => Promise.reject(new Error("mutation boom")),
      mutationKey: ["start-matchmaking-analysis"],
    });

    await expect(observer.mutate()).rejects.toThrow("mutation boom");

    expect(reportApiError).toHaveBeenCalledTimes(1);
    const reportedError = reportApiError.mock.calls[0]?.[0];
    const mutationContext = reportApiError.mock.calls[0]?.[1];
    expect(reportedError).toMatchObject({ kind: "unexpected" });
    expect(mutationContext).toEqual({
      source: "mutation",
      key: '["start-matchmaking-analysis"]',
    });

    expect(sonnerToast.error).not.toHaveBeenCalled();

    queryClient.clear();
  });

  it("hands auth failures to the reporter while staying silent for the viewer", async () => {
    const queryClient = createProvidersQueryClient();

    await expect(
      queryClient.fetchQuery({
        queryKey: ["session"],
        queryFn: () => Promise.reject(httpError(401)),
        retry: false,
      }),
    ).rejects.toThrow("Request failed with status code 401");

    // Whether an authentication kind is worth recording is the reporter's
    // call; the cache handler itself must always delegate the normalized error
    // and never announce an auth failure the gate already redirects on.
    expect(reportApiError).toHaveBeenCalledTimes(1);
    expect(reportApiError.mock.calls[0]?.[0]).toMatchObject({
      kind: "authentication",
    });
    expect(sonnerToast.error).not.toHaveBeenCalled();

    queryClient.clear();
  });
});

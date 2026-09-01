import { skipToken } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  SERVICE_STATUS_QUERY_KEY,
  serviceStatusQueryOptions,
} from "@/lib/core/service-status-query";
import {
  smurfBoostQueryKey,
  smurfBoostQueryOptions,
} from "@/features/smurf-boost/smurf-boost-query";

/**
 * The test harness's `QueryClient` sets no `staleTime` or `refetchInterval`,
 * so a render test could not prove these. Assert the returned object.
 */

describe("serviceStatusQueryOptions", () => {
  it("shares one key, so the header and the settings card cannot disagree", () => {
    expect(SERVICE_STATUS_QUERY_KEY).toEqual(["service-status"]);
    expect(serviceStatusQueryOptions().queryKey).toBe(SERVICE_STATUS_QUERY_KEY);
  });

  it("polls on a schedule and is enabled unless a caller says otherwise", () => {
    const options = serviceStatusQueryOptions();

    expect(options.enabled).toBe(true);
    expect(options.staleTime).toBe(5_000);
    expect(options.refetchInterval).toBe(15_000);
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it("lets a caller disable it without losing the rest of the schedule", () => {
    expect(serviceStatusQueryOptions({ enabled: false }).enabled).toBe(false);
    expect(serviceStatusQueryOptions({ enabled: true }).enabled).toBe(true);
    expect(serviceStatusQueryOptions({}).enabled).toBe(true);
  });
});

describe("smurfBoostQueryOptions", () => {
  it("keys on the player, so one player's answer never serves another", () => {
    expect(smurfBoostQueryKey("p1")).toEqual(["smurf-boost-detection", "p1"]);
    expect(smurfBoostQueryKey(null)).toEqual(["smurf-boost-detection", null]);
    expect(smurfBoostQueryOptions("p1").queryKey).toEqual(
      smurfBoostQueryKey("p1"),
    );
  });

  it("skips rather than disables when there is no player", () => {
    // `skipToken`, not `enabled`: a spreading caller can drop `enabled` and fire a
    // request for `null`.
    expect(smurfBoostQueryOptions(null).queryFn).toBe(skipToken);
    expect(smurfBoostQueryOptions("p1").queryFn).not.toBe(skipToken);
  });

  it("does not retry and reports its own failure inline", () => {
    const options = smurfBoostQueryOptions("p1");

    expect(options.retry).toBe(false);
    expect(options.staleTime).toBe(30_000);
    // The card renders a destructive alert, so the global toast would be a
    // second announcement of the same failure.
    expect(options.meta).toEqual({ silenceErrorToast: true });
  });
});

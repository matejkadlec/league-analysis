import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { queryErrorToast } from "@/lib/core/hooks";

function httpError(status: number, detail?: string): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError(
    `Request failed with status code ${status}`,
    String(status),
    { headers },
    {},
    {
      status,
      statusText: "",
      headers,
      config: { headers },
      data: detail === undefined ? {} : { detail },
    },
  );
}

describe("queryErrorToast", () => {
  it("announces a failed fetch that a call site would otherwise swallow", () => {
    const toast = queryErrorToast(httpError(500));

    expect(toast).not.toBeNull();
    expect(toast?.variant).toBe("error");
    expect(toast?.title).toBe("Could not load this data");
  });

  it("stays silent while the auth gate is already redirecting", () => {
    expect(queryErrorToast(httpError(401))).toBeNull();
    expect(queryErrorToast(httpError(403))).toBeNull();
  });

  it("lets a call site opt out and name its own failure", () => {
    expect(queryErrorToast(httpError(500), { silenceErrorToast: true })).toBe(
      null,
    );
    expect(
      queryErrorToast(httpError(500), { errorTitle: "Could not load matches" })
        ?.title,
    ).toBe("Could not load matches");
  });

  it("collapses one outage into a single toast rather than one per query", () => {
    // Every query in flight fails with the same kind, so a shared id lets the
    // toast host replace rather than stack them.
    const first = queryErrorToast(httpError(500));
    const second = queryErrorToast(httpError(500));

    expect(first?.id).toBe(second?.id);

    // A different failure still gets to speak for itself.
    expect(queryErrorToast(httpError(404))?.id).not.toBe(first?.id);
  });

  it("passes through a validation message the server wrote for the viewer", () => {
    const toast = queryErrorToast(httpError(422, "Pick a queue before saving"));

    expect(toast?.description).toBe("Pick a queue before saving");
  });

  it("does not leak a server error the viewer cannot act on", () => {
    // `normalizeApiError` keeps its own wording for a 500 rather than
    // forwarding whatever the backend said, so the toast inherits that.
    const toast = queryErrorToast(httpError(500, "psycopg.OperationalError"));

    expect(toast?.description).toBe("Please try again in a moment.");
  });
});

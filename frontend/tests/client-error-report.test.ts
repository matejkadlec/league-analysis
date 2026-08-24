// @vitest-environment node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/client-error-report/route";
import {
  CLIENT_ERROR_REPORT_PATH,
  ClientErrorReportSchema,
  writeClientErrorLog,
} from "@/lib/core/client-error-report";

function post(body: unknown, origin?: string): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin !== undefined) {
    headers.set("origin", origin);
  }
  return POST(
    new Request(`http://localhost:3000${CLIENT_ERROR_REPORT_PATH}`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("the client-error beacon", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("writes a structured line the container log can grep", () => {
    writeClientErrorLog({
      kind: "chunk",
      message: "Loading chunk 1-1rz19yxhyis failed",
      filename: "/_next/static/chunks/1-1rz19yxhyis.js",
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    const line = consoleError.mock.calls[0]?.[0];
    expect(typeof line).toBe("string");
    expect(JSON.parse(line as string)).toEqual({
      event: "client_error",
      kind: "chunk",
      message: "Loading chunk 1-1rz19yxhyis failed",
      filename: "/_next/static/chunks/1-1rz19yxhyis.js",
    });
  });

  it("logs a valid POST and always answers 204", async () => {
    const response = await post({
      kind: "react",
      message: "Minified React error #130",
      source: "boundary",
    });

    expect(response.status).toBe(204);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.parse(consoleError.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "client_error",
      kind: "react",
      message: "Minified React error #130",
    });
  });

  it("drops a cross-origin POST without logging it", async () => {
    const response = await post(
      { kind: "window", message: "injected" },
      "https://evil.example",
    );

    expect(response.status).toBe(204);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("drops an oversized or invalid body without logging it", async () => {
    expect((await post("not-json")).status).toBe(204);
    expect(
      (await post({ kind: "react", message: "x".repeat(500) })).status,
    ).toBe(204);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("rejects a query key or other undeclared field rather than logging it", () => {
    const parsed = ClientErrorReportSchema.safeParse({
      kind: "api",
      message: "The request could not be completed. Please try again later.",
      key: '["lane-stats","PNm-92VrUvdu-cj0KFhqs0_8dNV2g9DsQ2pObEKsJZum-3uISPmVr2xn2eI1ztzq10TJb9M-ZpdbdQ",420]',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("key" in parsed.data).toBe(false);
    }
  });
});

describe("the proxy and the reporter agree on the path", () => {
  it("is the literal isStaticOrInternal allows through without a session", () => {
    const proxy = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "proxy.ts"),
      "utf8",
    );
    expect(CLIENT_ERROR_REPORT_PATH).toBe("/client-error-report");
    expect(proxy).toContain(`pathname === "${CLIENT_ERROR_REPORT_PATH}"`);
  });
});

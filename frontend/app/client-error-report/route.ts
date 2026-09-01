import { NextResponse } from "next/server";

import {
  ClientErrorReportSchema,
  writeClientErrorLog,
} from "@/lib/core/http/client-error-report";
import { parseUntrustedJson } from "@/lib/core/http/untrusted-json";

const MAX_BODY_BYTES = 1024;
const WINDOW_MS = 10_000;
const MAX_IN_WINDOW = 20;

let recent: number[] = [];

function accept(): boolean {
  const now = Date.now();
  recent = recent.filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= MAX_IN_WINDOW) {
    return false;
  }
  recent.push(now);
  return true;
}

/**
 * Always 204: a 4xx here would itself become another client error, and without
 * the swallow in `reportClientError`, a loop.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return new NextResponse(null, { status: 204 });
  }

  const raw = await request.text();
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES || !accept()) {
    return new NextResponse(null, { status: 204 });
  }

  const report = parseUntrustedJson(ClientErrorReportSchema, raw);
  if (report) {
    writeClientErrorLog(report);
  }
  return new NextResponse(null, { status: 204 });
}

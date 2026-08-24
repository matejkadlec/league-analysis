import { NextResponse } from "next/server";

import {
  ClientErrorReportSchema,
  writeClientErrorLog,
} from "@/lib/core/client-error-report";

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
 * Always 204: this is a beacon, not a product API. A 4xx here would become
 * another client error and, without the swallow in `reportClientError`, a
 * loop. Invalid or cross-origin bodies are dropped.
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

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw) as unknown;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const parsed = ClientErrorReportSchema.safeParse(parsedJson);
  if (parsed.success) {
    writeClientErrorLog(parsed.data);
  }
  return new NextResponse(null, { status: 204 });
}

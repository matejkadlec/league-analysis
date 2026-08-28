import { z } from "zod";

/**
 * Parse JSON that came from outside this app -- browser storage, a beacon body
 * -- through a schema. Anything malformed or unexpected is `null`, so a caller
 * needs one branch rather than a hand-rolled shape check per reader.
 */
export function parseUntrustedJson<T>(
  schema: z.ZodType<T>,
  raw: string | null | undefined,
): T | null {
  if (!raw) {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

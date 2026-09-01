import { z } from "zod";

/**
 * Parse JSON from outside this app through a schema. Anything malformed or
 * unexpected is `null`, so a caller needs one branch, not a shape check.
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

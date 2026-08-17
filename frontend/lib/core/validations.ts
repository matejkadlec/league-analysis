import { z } from "zod";

const playerNameValidation = z
  .string()
  .min(1, "Player name is required")
  .transform((val) => val.trim())
  .superRefine((val, ctx) => {
    // Basic format check
    // Logic: Name > 16 chars, Tag > 5 chars

    // We expect the # to be present if it's coming from our controlled input
    const parts = val.split("#");
    // `String.prototype.split` always yields at least one element, so the
    // fallback is unreachable and only satisfies the compiler.
    const name = parts[0] ?? "";
    // If there are multiple # (which shouldn't happen if controlled), we take the last part or join?
    // Let's assume standard Name#Tag format.
    const tag = parts.length > 1 ? parts.slice(1).join("#") : "";

    if (name.length > 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Player name is too long, please check your input.",
      });
    }

    // Tag limit: User said > 5 chars (so max 5)
    if (tag.length > 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tag line is too long, please check your input.",
      });
    }
  });

const platformEnum = z.enum([
  "eun1",
  "euw1",
  "na1",
  "kr",
  "br1",
  "la1",
  "la2",
  "oc1",
  "ru",
  "tr1",
  "jp1",
  "ph2",
  "sg2",
  "th2",
  "tw2",
  "vn2",
]);

export const playerSearchSchema = z.object({
  searchValue: playerNameValidation,
  platform: platformEnum,
});

export type PlayerSearchForm = z.infer<typeof playerSearchSchema>;

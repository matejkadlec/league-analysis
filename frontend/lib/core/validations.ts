import { z } from "zod";

const playerNameRefinement = (val: string) => {
  const trimmed = val.trim();

  if (trimmed.includes("#")) {
    const parts = trimmed.split("#");
    if (parts.length !== 2) return false;

    const [name, tag] = parts;
    return (
      name &&
      name.length >= 3 &&
      name.length <= 16 &&
      tag &&
      tag.length >= 1 &&
      tag.length <= 6
    );
  }

  return trimmed.length >= 3 && trimmed.length <= 16;
};

const playerNameValidation = z
  .string()
  .min(1, "Player name is required")
  .transform((val) => val.trim())
  .refine(playerNameRefinement, {
    message:
      "Invalid format. Use 'Name#TAG' (tag max 6 chars) or summoner name (3-16 chars)",
  });

const regionEnum = z.enum([
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
  region: regionEnum,
});

export type PlayerSearchForm = z.infer<typeof playerSearchSchema>;

export const addTrackedPlayerSchema = z.object({
  searchValue: playerNameValidation,
  region: regionEnum,
});

export type AddTrackedPlayerForm = z.infer<typeof addTrackedPlayerSchema>;

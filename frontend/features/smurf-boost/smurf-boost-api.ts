import { z } from "zod";

import {
  validatedDelete,
  validatedGet,
  validatedPost,
  validatedPut,
  type ApiResponse,
} from "@/lib/core/api";
import {
  CardPreference,
  CardPreferenceSchema,
  SmurfBoostAnalysisResponse,
  SmurfBoostAnalysisResponseSchema,
  SmurfBoostPresetsResponse,
  SmurfBoostPresetsResponseSchema,
} from "@/lib/core/schemas";
import type { CardId } from "@/lib/core/schemas";

export async function startSmurfBoostDetection(
  puuid: string,
): Promise<ApiResponse<SmurfBoostAnalysisResponse>> {
  return validatedPost(
    SmurfBoostAnalysisResponseSchema,
    "/smurf-boost-detection/analyze",
    { puuid },
  );
}

export async function getLatestSmurfBoostDetection(
  puuid: string,
): Promise<ApiResponse<SmurfBoostAnalysisResponse>> {
  return validatedGet(
    SmurfBoostAnalysisResponseSchema,
    `/smurf-boost-detection/player/${puuid}`,
  );
}

export async function getSmurfBoostPresets(): Promise<
  ApiResponse<SmurfBoostPresetsResponse>
> {
  return validatedGet(
    SmurfBoostPresetsResponseSchema,
    "/smurf-boost-detection/presets",
  );
}

// Card preferences live here because the smurf-boost settings card is their
// only consumer today; move them to a shared home when a second card needs
// them.
export async function getCardPreferences(): Promise<
  ApiResponse<CardPreference[]>
> {
  return validatedGet(
    z.array(CardPreferenceSchema),
    "/settings/card-preferences",
  );
}

export async function updateCardPreference(
  cardId: CardId,
  settings: Record<string, number>,
): Promise<ApiResponse<CardPreference>> {
  return validatedPut(
    CardPreferenceSchema,
    `/settings/card-preferences/${cardId}`,
    { version: 1, settings },
  );
}

export async function resetCardPreference(
  cardId: CardId,
): Promise<ApiResponse<CardPreference>> {
  return validatedDelete(
    CardPreferenceSchema,
    `/settings/card-preferences/${cardId}`,
  );
}

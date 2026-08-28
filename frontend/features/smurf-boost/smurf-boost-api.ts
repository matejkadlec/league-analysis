import { z } from "zod";

import {
  validatedDelete,
  validatedGet,
  validatedPost,
  validatedPut,
  type ApiResponse,
} from "@/lib/core/http/api";
import {
  CardPreference,
  CardPreferenceSchema,
  CardPreferenceUpdate,
  SmurfBoostAnalysisRequest,
  SmurfBoostAnalysisResponse,
  SmurfBoostAnalysisResponseSchema,
  SmurfBoostPresetsResponse,
  SmurfBoostPresetsResponseSchema,
} from "@/lib/core/schemas";
import type { CardId } from "@/lib/core/schemas";
import type { ThresholdSettings } from "./smurf-boost-settings";

export async function startSmurfBoostDetection(
  puuid: string,
): Promise<ApiResponse<SmurfBoostAnalysisResponse>> {
  return validatedPost(
    SmurfBoostAnalysisResponseSchema,
    "/smurf-boost-detection/analyze",
    { puuid } satisfies SmurfBoostAnalysisRequest,
  );
}

export async function getLatestSmurfBoostDetection(
  puuid: string,
  signal?: AbortSignal,
): Promise<ApiResponse<SmurfBoostAnalysisResponse>> {
  return validatedGet(
    SmurfBoostAnalysisResponseSchema,
    `/smurf-boost-detection/player/${puuid}`,
    { signal },
  );
}

export async function getSmurfBoostPresets(
  signal?: AbortSignal,
): Promise<ApiResponse<SmurfBoostPresetsResponse>> {
  return validatedGet(
    SmurfBoostPresetsResponseSchema,
    "/smurf-boost-detection/presets",
    { signal },
  );
}

// Card preferences live here because the smurf-boost settings card is their
// only consumer today; move them to a shared home when a second card needs
// them.
export async function getCardPreferences(
  signal?: AbortSignal,
): Promise<ApiResponse<CardPreference[]>> {
  return validatedGet(
    z.array(CardPreferenceSchema),
    "/settings/card-preferences",
    { signal },
  );
}

export async function updateCardPreference(
  cardId: CardId,
  settings: ThresholdSettings,
): Promise<ApiResponse<CardPreference>> {
  return validatedPut(
    CardPreferenceSchema,
    `/settings/card-preferences/${cardId}`,
    { version: 1, settings } satisfies CardPreferenceUpdate,
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

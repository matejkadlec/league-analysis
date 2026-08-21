import { z } from "zod";

// ===== SYSTEM SETTINGS SCHEMA =====
export const SettingSchema = z.object({
  key: z.string(),
  masked_value: z.string(),
  category: z.string(),
  is_sensitive: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const SettingTestResponseSchema = z.object({
  success: z.boolean(),
  status: z.enum(["valid", "invalid", "unavailable"]),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type Setting = z.infer<typeof SettingSchema>;
export type SettingTestResponse = z.infer<typeof SettingTestResponseSchema>;

export const SettingUpdateSchema = z.object({
  value: z.string(),
});
export type SettingUpdate = z.infer<typeof SettingUpdateSchema>;

export const CardPreferenceUpdateSchema = z.object({
  version: z.literal(1),
  settings: z.record(z.string(), z.unknown()),
});
export type CardPreferenceUpdate = z.infer<typeof CardPreferenceUpdateSchema>;

export const CookieConsentLevelSchema = z.enum(["necessary", "all"]);
export type CookieConsentLevel = z.infer<typeof CookieConsentLevelSchema>;

export const UserCookieConsentUpdateSchema = z.object({
  consent_level: CookieConsentLevelSchema,
  consent_version: z.string(),
  consent_source: z.string(),
});
export type UserCookieConsentUpdate = z.infer<
  typeof UserCookieConsentUpdateSchema
>;

export const UserCookieConsentResponseSchema = z.object({
  consent_level: CookieConsentLevelSchema,
  consent_version: z.string(),
  consent_source: z.string(),
  consented_at: z.string(),
});

// One viewer's effective settings for one analytical card. `settings` carries
// the card's fixed values alongside its mutable ones, so a write must send
// back only the fields the write contract accepts. Values are not all numbers
// — Top Champions carries a role list — and this response returns every card,
// so a numeric-only shape here would reject the whole catalog.
/** The three analytical cards the settings API answers for, by its own ids. */
export const CardIdSchema = z.enum([
  "profile.top-champions",
  "profile.recent-performance",
  "profile.smurf-boost-detection",
]);
export type CardId = z.infer<typeof CardIdSchema>;

export const CardPreferenceSchema = z.object({
  cardId: CardIdSchema,
  version: z.literal(1),
  settings: z.record(z.string(), z.unknown()),
  isDefault: z.boolean(),
  requiresRecovery: z.boolean().default(false),
  updatedAt: z.string().nullable().optional(),
});

export type CardPreference = z.infer<typeof CardPreferenceSchema>;

// Riot credential health, as the header banner and the settings card each
// read it. Both used to declare their own copy next to the component, which
// put them outside `tests/api-contract-alignment.test.ts` -- the only check
// that compares a zod shape to what FastAPI actually serialises. Both copies
// said `z.number()` for a `health_revision` the API declares as an integer.
const credentialStatus = z.enum(["missing", "unknown", "valid", "invalid"]);

export const ServiceStatusSchema = z.object({
  is_under_maintenance: z.boolean(),
  reason: z.enum(["ok", "api_key_missing", "api_key_invalid"]),
  credential_status: credentialStatus,
  health_revision: z.number().int(),
  observed_at: z.string(),
  has_recent_recovery: z.boolean(),
  recovery_notice_key: z.string().nullable(),
});

export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

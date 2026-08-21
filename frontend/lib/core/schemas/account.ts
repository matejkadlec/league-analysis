import { z } from "zod";

// ===== USER PROFILE SCHEMAS =====
export const UserResponseSchema = z.object({
  id: z.number().int(),
  email: z.email(),
  display_name: z.string(),
  is_active: z.boolean(),
  is_admin: z.boolean(),
  email_verified: z.boolean(),
  email_verified_at: z.string().nullable(),
  last_login: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type UserResponse = z.infer<typeof UserResponseSchema>;

/**
 * Request bodies.
 *
 * `validatedPost` and friends take the body as `unknown`, so a field the
 * backend renamed stayed a compile-time nothing and became a 422 at runtime.
 * Every body the frontend sends is declared here and applied at the call site
 * with `satisfies`, which makes an unknown or missing field a type error.
 *
 * These are never `.parse()`d: the server is the authority on the values and
 * rejects a bad one regardless, so lengths and patterns are left out rather
 * than restated. What is worth stating is the shape, and stating it here is
 * what puts it inside `tests/api-contract-alignment.test.ts` -- the pairing
 * there is by name over exported zod schemas, so a hand-written TS type (what
 * `UserProfileUpdate` was) is invisible to it and drifts silently.
 */
export const UserProfileUpdateSchema = z.object({
  display_name: z.string().nullable().optional(),
});
export type UserProfileUpdate = z.infer<typeof UserProfileUpdateSchema>;

export const EmailChangeRequestSchema = z.object({
  new_email: z.email(),
});
export type EmailChangeRequest = z.infer<typeof EmailChangeRequestSchema>;

export const EmailChangeVerifyRequestSchema = z.object({
  code: z.string(),
});
export type EmailChangeVerifyRequest = z.infer<
  typeof EmailChangeVerifyRequestSchema
>;

export const PasswordChangeRequestSchema = z.object({
  current_password: z.string(),
  new_password: z.string(),
  repeat_password: z.string(),
});
export type PasswordChangeRequest = z.infer<typeof PasswordChangeRequestSchema>;

export const JoinUsSubjectSchema = z.enum([
  "beta_tester",
  "full_stack_developer",
  "other",
]);
export type JoinUsSubject = z.infer<typeof JoinUsSubjectSchema>;

export const JoinUsContactRequestSchema = z.object({
  subject: JoinUsSubjectSchema,
  body: z.string(),
  captcha_token: z.string().nullable().optional(),
});
export type JoinUsContactRequest = z.infer<typeof JoinUsContactRequestSchema>;

export const EmailChangeCodeResponseSchema = z.object({
  message: z.string(),
  expires_at: z.string(),
});

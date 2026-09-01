import { z } from "zod";

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
 * Applied with `satisfies`, never `.parse()`d: an unknown or missing field is a
 * type error rather than a runtime 422, and zod puts them in the contract test.
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

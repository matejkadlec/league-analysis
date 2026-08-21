import { z } from "zod";

export const MessageResponseSchema = z.object({
  message: z.string(),
});

export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const paginationFields = {
  total: z.number().int(),
  page: z.number().int(),
  size: z.number().int(),
  pages: z.number().int(),
};

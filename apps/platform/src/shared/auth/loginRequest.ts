import { z } from 'zod';

export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MAX_LENGTH = 1024;

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(EMAIL_MAX_LENGTH),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

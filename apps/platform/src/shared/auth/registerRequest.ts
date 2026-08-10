import { z } from 'zod';

import { EMAIL_MAX_LENGTH } from './loginRequest';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_REGISTER_MAX_LENGTH = 128;

const passwordRules = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_REGISTER_MAX_LENGTH)
  .refine(value => /[a-zA-Zа-яА-ЯёЁ]/.test(value) && /\d/.test(value), {
    message: 'password_weak',
  });

export const registerRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(EMAIL_MAX_LENGTH),
  password: passwordRules,
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

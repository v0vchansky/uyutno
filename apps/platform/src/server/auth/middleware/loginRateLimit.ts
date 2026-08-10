import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

import { TooManyRequestsError } from '@server/common';

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 5;
const RATE_LIMITED_MESSAGE = 'Слишком много попыток, попробуйте позже';

const denyHandler: RequestHandler = (_req, _res, next) => {
  next(new TooManyRequestsError(RATE_LIMITED_MESSAGE));
};

export const loginIpRateLimit: RequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  limit: LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: denyHandler,
});

export const loginEmailRateLimit: RequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  limit: LIMIT,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req): string => {
    const raw = (req.body as { email?: unknown } | undefined)?.email;
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return email.length > 0 ? `email:${email}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
  },
  handler: denyHandler,
});

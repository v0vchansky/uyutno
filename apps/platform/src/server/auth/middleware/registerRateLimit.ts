import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

import { TooManyRequestsError } from '@server/common';

const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 10;
const RATE_LIMITED_MESSAGE = 'Слишком много попыток, попробуйте позже';

const denyHandler: RequestHandler = (_req, _res, next) => {
  next(new TooManyRequestsError(RATE_LIMITED_MESSAGE));
};

export const registerIpRateLimit: RequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  limit: LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: denyHandler,
});

import type { Request, RequestHandler, Response } from 'express';

import { normalizeFromParam } from '../lib/normalizeFromParam';

const DEFAULT_TARGET = '/projects';

export const redirectIfAuthenticated: RequestHandler = (req: Request, res: Response, next): void => {
  if (!req.user) {
    next();
    return;
  }

  const from = normalizeFromParam(req.query.from);
  res.redirect(from ?? DEFAULT_TARGET);
};

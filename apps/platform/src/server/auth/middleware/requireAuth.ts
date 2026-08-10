import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { UnauthorizedError } from '@server/common';

import { normalizeFromParam } from '../lib/normalizeFromParam';

type RouteKind = 'api' | 'page';

const buildLoginRedirectUrl = (req: Request): string => {
  const from = normalizeFromParam(req.originalUrl);
  if (!from) return '/login';
  return `/login?from=${encodeURIComponent(from)}`;
};

export const requireAuth =
  (kind: RouteKind): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (req.user) {
      next();
      return;
    }

    if (kind === 'api') {
      next(new UnauthorizedError());
      return;
    }

    res.redirect(buildLoginRedirectUrl(req));
  };

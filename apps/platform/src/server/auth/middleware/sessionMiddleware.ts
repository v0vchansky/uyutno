import type { NextFunction, Request, Response } from 'express';

import type { AuthManager, CurrentUser } from '../managers/AuthManager';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: CurrentUser | null;
    }
  }
}

export const createSessionMiddleware =
  (authManager: AuthManager) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      req.user = await authManager.getCurrentUser(req, res);
      next();
    } catch (err) {
      next(err);
    }
  };

import type { Request, RequestHandler, Response } from 'express';

import { SESSION_COOKIE_NAME, clearSessionCookie } from '../lib/cookies';
import type { SessionManager } from '../managers/SessionManager';

export const createLogoutController =
  (sessionManager: SessionManager): RequestHandler =>
  async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      await sessionManager.revokeSession(sessionId);
    }

    clearSessionCookie(res);
    res.redirect(302, '/');
  };

import type { Request, RequestHandler, Response } from 'express';

import { ValidationError } from '@server/common';
import { loginRequestSchema } from '../../../shared/auth';

import type { AuthManager } from '../managers/AuthManager';
import type { SessionManager } from '../managers/SessionManager';
import { setSessionCookie } from '../lib/cookies';

export const createLoginController =
  (authManager: AuthManager, sessionManager: SessionManager): RequestHandler =>
  async (req: Request, res: Response): Promise<void> => {
    const parsed = loginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Неверный формат запроса');
    }

    const { email, password } = parsed.data;
    const user = await authManager.verifyCredentials(email, password);
    const session = await sessionManager.issueSession(user.id);
    setSessionCookie(res, session.id);
    res.status(200).json({ user });
  };

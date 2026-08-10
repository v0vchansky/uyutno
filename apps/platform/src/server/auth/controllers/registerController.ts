import type { Request, RequestHandler, Response } from 'express';

import { ValidationError } from '@server/common';
import { registerRequestSchema } from '../../../shared/auth';

import type { AuthManager } from '../managers/AuthManager';
import type { SessionManager } from '../managers/SessionManager';
import { setSessionCookie } from '../lib/cookies';

export const createRegisterController =
  (authManager: AuthManager, sessionManager: SessionManager): RequestHandler =>
  async (req: Request, res: Response): Promise<void> => {
    const parsed = registerRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Неверный формат запроса');
    }

    const { email, password } = parsed.data;
    const user = await authManager.registerUser(email, password);
    const session = await sessionManager.issueSession(user.id);
    setSessionCookie(res, session.id);
    res.status(200).json({ user });
  };

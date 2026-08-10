import { Router } from 'express';

import { getMeController } from './controllers/getMeController';
import { createLoginController } from './controllers/loginController';
import type { AuthManager } from './managers/AuthManager';
import type { SessionManager } from './managers/SessionManager';
import { loginEmailRateLimit, loginIpRateLimit } from './middleware/loginRateLimit';
import { requireAuth } from './middleware/requireAuth';

interface AuthRouterDeps {
  authManager: AuthManager;
  sessionManager: SessionManager;
}

export const createAuthRouter = ({ authManager, sessionManager }: AuthRouterDeps): Router => {
  const router = Router();

  router.get('/me', getMeController);
  router.post('/login', loginIpRateLimit, loginEmailRateLimit, createLoginController(authManager, sessionManager));

  router.get('/_check', requireAuth('api'), (_req, res) => {
    res.json({ ok: true });
  });

  return router;
};

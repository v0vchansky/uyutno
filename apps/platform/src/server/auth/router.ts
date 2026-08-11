import { Router } from 'express';

import { getMeController } from './controllers/getMeController';
import { createLoginController } from './controllers/loginController';
import { createLogoutController } from './controllers/logoutController';
import { createOAuthCallbackController } from './controllers/oauthCallbackController';
import { createOAuthStartController } from './controllers/oauthStartController';
import { createRegisterController } from './controllers/registerController';
import type { AuthManager } from './managers/AuthManager';
import type { OAuthManager } from './managers/OAuthManager';
import type { SessionManager } from './managers/SessionManager';
import { loginEmailRateLimit, loginIpRateLimit } from './middleware/loginRateLimit';
import { oauthStartIpRateLimit } from './middleware/oauthStartRateLimit';
import { registerIpRateLimit } from './middleware/registerRateLimit';
import { requireAuth } from './middleware/requireAuth';
import type { OAuthProviderRegistry } from './oauth/providers';

interface AuthRouterDeps {
  authManager: AuthManager;
  sessionManager: SessionManager;
  oauthProviders: OAuthProviderRegistry;
}

export const createAuthRouter = ({ authManager, sessionManager, oauthProviders }: AuthRouterDeps): Router => {
  const router = Router();

  router.get('/me', getMeController);
  router.post('/login', loginIpRateLimit, loginEmailRateLimit, createLoginController(authManager, sessionManager));
  router.post('/register', registerIpRateLimit, createRegisterController(authManager, sessionManager));

  router.get('/oauth/:provider/start', oauthStartIpRateLimit, createOAuthStartController(oauthProviders));

  router.get('/_check', requireAuth('api'), (_req, res) => {
    res.json({ ok: true });
  });

  return router;
};

interface OAuthCallbackRouterDeps {
  oauthProviders: OAuthProviderRegistry;
  oauthManager: OAuthManager;
}

export const createOAuthCallbackRouter = ({ oauthProviders, oauthManager }: OAuthCallbackRouterDeps): Router => {
  const router = Router();
  router.get('/:provider', createOAuthCallbackController(oauthProviders, oauthManager));
  return router;
};

interface LogoutRouterDeps {
  sessionManager: SessionManager;
}

export const createLogoutRouter = ({ sessionManager }: LogoutRouterDeps): Router => {
  const router = Router();
  router.get('/logout', createLogoutController(sessionManager));
  return router;
};

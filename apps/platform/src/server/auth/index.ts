export { AuthManager } from './managers/AuthManager';
export type { CurrentUser } from './managers/AuthManager';
export { SessionManager } from './managers/SessionManager';
export { OAuthManager } from './managers/OAuthManager';
export { UsersRepository } from './repositories/usersRepository';
export { SessionsRepository } from './repositories/sessionsRepository';
export { OAuthAccountsRepository } from './repositories/oauthAccountsRepository';

export { createSessionMiddleware } from './middleware/sessionMiddleware';
export { requireAuth } from './middleware/requireAuth';
export { redirectIfAuthenticated } from './middleware/redirectIfAuthenticated';

export { createAuthRouter, createOAuthCallbackRouter } from './router';

export { createOAuthProviderRegistry } from './oauth/providers';
export type { OAuthProviderRegistry } from './oauth/providers';

export { SESSION_COOKIE_NAME, SESSION_TTL_MS, setSessionCookie, clearSessionCookie } from './lib/cookies';
export { normalizeFromParam } from './lib/normalizeFromParam';
export { generateSessionId } from './lib/sessionId';

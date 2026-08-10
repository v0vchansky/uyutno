export { AuthManager } from './managers/AuthManager';
export type { CurrentUser } from './managers/AuthManager';
export { SessionManager } from './managers/SessionManager';
export { UsersRepository } from './repositories/usersRepository';
export { SessionsRepository } from './repositories/sessionsRepository';

export { createSessionMiddleware } from './middleware/sessionMiddleware';
export { requireAuth } from './middleware/requireAuth';
export { redirectIfAuthenticated } from './middleware/redirectIfAuthenticated';

export { createAuthRouter } from './router';

export { SESSION_COOKIE_NAME, SESSION_TTL_MS, setSessionCookie, clearSessionCookie } from './lib/cookies';
export { normalizeFromParam } from './lib/normalizeFromParam';
export { generateSessionId } from './lib/sessionId';

import {
  AuthManager,
  OAuthAccountsRepository,
  OAuthManager,
  SessionManager,
  SessionsRepository,
  UsersRepository,
  createOAuthProviderRegistry,
} from '@server/auth';
import type { OAuthProviderRegistry } from '@server/auth';
import { db } from '@server/postgres';

export interface ServerRegistry {
  authManager: AuthManager;
  sessionManager: SessionManager;
  oauthManager: OAuthManager;
  oauthProviders: OAuthProviderRegistry;
}

export const createServerRegistry = (): ServerRegistry => {
  const usersRepository = new UsersRepository(db);
  const sessionsRepository = new SessionsRepository(db);
  const oauthAccountsRepository = new OAuthAccountsRepository(db);
  const sessionManager = new SessionManager(sessionsRepository);
  const authManager = new AuthManager(usersRepository, sessionManager);
  const oauthManager = new OAuthManager(usersRepository, oauthAccountsRepository, sessionManager);
  const oauthProviders = createOAuthProviderRegistry();

  return { authManager, sessionManager, oauthManager, oauthProviders };
};

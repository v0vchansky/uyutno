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
import { ProjectsManager, ProjectsRepository } from '@server/projects';

export interface ServerRegistry {
  authManager: AuthManager;
  sessionManager: SessionManager;
  oauthManager: OAuthManager;
  oauthProviders: OAuthProviderRegistry;
  projectsManager: ProjectsManager;
}

export const createServerRegistry = (): ServerRegistry => {
  const usersRepository = new UsersRepository(db);
  const sessionsRepository = new SessionsRepository(db);
  const oauthAccountsRepository = new OAuthAccountsRepository(db);
  const sessionManager = new SessionManager(sessionsRepository);
  const authManager = new AuthManager(usersRepository, sessionManager);
  const oauthManager = new OAuthManager(usersRepository, oauthAccountsRepository, sessionManager);
  const oauthProviders = createOAuthProviderRegistry();
  const projectsRepository = new ProjectsRepository(db);
  const projectsManager = new ProjectsManager(projectsRepository);

  return { authManager, sessionManager, oauthManager, oauthProviders, projectsManager };
};

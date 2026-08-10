import { AuthManager, SessionManager, SessionsRepository, UsersRepository } from '@server/auth';
import { db } from '@server/postgres';

export interface ServerRegistry {
  authManager: AuthManager;
  sessionManager: SessionManager;
}

export const createServerRegistry = (): ServerRegistry => {
  const usersRepository = new UsersRepository(db);
  const sessionsRepository = new SessionsRepository(db);
  const sessionManager = new SessionManager(sessionsRepository);
  const authManager = new AuthManager(usersRepository, sessionManager);

  return { authManager, sessionManager };
};

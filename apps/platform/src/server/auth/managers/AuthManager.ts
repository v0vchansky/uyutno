import type { Request, Response } from 'express';

import { UnauthorizedError } from '@server/common';

import type { UserRow, UsersRepository } from '../repositories/usersRepository';
import type { SessionManager } from './SessionManager';
import { SESSION_COOKIE_NAME, clearSessionCookie } from '../lib/cookies';
import { verifyPassword } from '../lib/passwords';

export interface CurrentUser {
  id: string;
  email: string;
}

const INVALID_CREDENTIALS_MESSAGE = 'Неверная почта или пароль';

const toCurrentUser = (user: UserRow): CurrentUser => ({ id: user.id, email: user.email });

export class AuthManager {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly sessionManager: SessionManager,
  ) {}

  async getCurrentUser(req: Request, res: Response): Promise<CurrentUser | null> {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof sessionId !== 'string' || sessionId.length === 0) return null;

    const session = await this.sessionManager.readSession(sessionId);
    if (!session) {
      clearSessionCookie(res);
      return null;
    }

    const user = await this.usersRepository.findById(session.userId);
    if (!user) {
      await this.sessionManager.revokeSession(sessionId);
      clearSessionCookie(res);
      return null;
    }

    await this.sessionManager.touchSession(sessionId);
    return toCurrentUser(user);
  }

  async verifyCredentials(email: string, password: string): Promise<CurrentUser> {
    const user = await this.usersRepository.findByEmail(email);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);
    }

    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);
    }

    return toCurrentUser(user);
  }
}

import { UnauthorizedError } from '@server/common';

import { hashPassword } from '../lib/passwords';
import type { UserRow, UsersRepository } from '../repositories/usersRepository';
import { AuthManager } from './AuthManager';
import type { SessionManager } from './SessionManager';

const buildUser = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: '01900000-0000-7000-8000-000000000001',
  email: 'user@example.com',
  passwordHash: null,
  emailVerifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const buildUsersRepository = (user: UserRow | null): UsersRepository =>
  ({
    findByEmail: async () => user,
  }) as unknown as UsersRepository;

const noopSessionManager = {} as unknown as SessionManager;

describe('AuthManager.verifyCredentials', () => {
  it('возвращает пользователя при верных кредах', async () => {
    const passwordHash = await hashPassword('correct-horse-battery-staple');
    const user = buildUser({ passwordHash });
    const manager = new AuthManager(buildUsersRepository(user), noopSessionManager);

    const result = await manager.verifyCredentials('user@example.com', 'correct-horse-battery-staple');

    expect(result).toEqual({ id: user.id, email: user.email });
  });

  it('бросает UnauthorizedError, когда юзер не найден', async () => {
    const manager = new AuthManager(buildUsersRepository(null), noopSessionManager);
    await expect(manager.verifyCredentials('unknown@example.com', 'pw')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('бросает UnauthorizedError для OAuth-only юзера без password_hash', async () => {
    const manager = new AuthManager(buildUsersRepository(buildUser({ passwordHash: null })), noopSessionManager);
    await expect(manager.verifyCredentials('user@example.com', 'pw')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('бросает UnauthorizedError при неверном пароле', async () => {
    const passwordHash = await hashPassword('correct-horse-battery-staple');
    const manager = new AuthManager(buildUsersRepository(buildUser({ passwordHash })), noopSessionManager);
    await expect(manager.verifyCredentials('user@example.com', 'wrong')).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

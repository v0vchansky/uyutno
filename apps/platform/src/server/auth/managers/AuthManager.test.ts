import { ConflictError, UnauthorizedError } from '@server/common';

import { hashPassword, verifyPassword } from '../lib/passwords';
import type { UserRow, UsersRepository } from '../repositories/usersRepository';
import { AuthManager, EMAIL_TAKEN_CODE } from './AuthManager';
import type { SessionManager } from './SessionManager';

const buildUser = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: '01900000-0000-7000-8000-000000000001',
  email: 'user@example.com',
  displayName: null,
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

    expect(result).toEqual({ id: user.id, email: user.email, displayName: user.displayName });
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

describe('AuthManager.registerUser', () => {
  const buildCreatingRepository = (): UsersRepository => {
    let stored: UserRow | null = null;
    return {
      findByEmail: async () => stored,
      create: async ({
        email,
        passwordHash,
        displayName,
      }: {
        email: string;
        passwordHash: string | null;
        displayName: string | null;
      }) => {
        stored = buildUser({ email, passwordHash, displayName });
        return stored;
      },
    } as unknown as UsersRepository;
  };

  it('создаёт пользователя, хеширует пароль и сохраняет displayName', async () => {
    const repository = buildCreatingRepository();
    const manager = new AuthManager(repository, noopSessionManager);

    const user = await manager.registerUser('new@example.com', 'letmein42', 'Аня');

    expect(user.email).toBe('new@example.com');
    expect(user.displayName).toBe('Аня');
    const stored = await repository.findByEmail('new@example.com');
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe('letmein42');
    expect(await verifyPassword(stored!.passwordHash!, 'letmein42')).toBe(true);
  });

  it('бросает ConflictError с кодом email_taken, если email уже занят', async () => {
    const manager = new AuthManager(buildUsersRepository(buildUser()), noopSessionManager);

    const error = await manager.registerUser('user@example.com', 'letmein42', 'Аня').catch(err => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe(EMAIL_TAKEN_CODE);
  });
});

import type { OAuthProviderId } from '../oauth/OAuthProvider';
import type { OAuthAccountRow, OAuthAccountsRepository } from '../repositories/oauthAccountsRepository';
import type { UserRow, UsersRepository } from '../repositories/usersRepository';
import type { SessionRow } from '../repositories/sessionsRepository';
import type { SessionManager } from './SessionManager';
import { OAuthManager } from './OAuthManager';

const buildUser = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: '01900000-0000-7000-8000-000000000001',
  email: 'user@example.com',
  passwordHash: null,
  emailVerifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const buildSession = (userId: string): SessionRow => ({
  id: `session-${userId}`,
  userId,
  expiresAt: new Date(Date.now() + 1_000),
  lastActivityAt: new Date(),
  createdAt: new Date(),
});

interface Fakes {
  users: UsersRepository;
  oauthAccounts: OAuthAccountsRepository;
  sessions: SessionManager;
  created: { user: UserRow | null; link: OAuthAccountRow | null };
}

const buildFakes = (options: { existingLink?: OAuthAccountRow | null; userByEmail?: UserRow | null }): Fakes => {
  const created: Fakes['created'] = { user: null, link: null };

  const users: UsersRepository = {
    findByEmail: async () => options.userByEmail ?? null,
    findById: async () => null,
    create: async ({ email, passwordHash }: { email: string; passwordHash: string | null }) => {
      const user = buildUser({ id: `user-${email}`, email, passwordHash });
      created.user = user;
      return user;
    },
  } as unknown as UsersRepository;

  const oauthAccounts: OAuthAccountsRepository = {
    findByProviderUser: async () => options.existingLink ?? null,
    create: async ({
      userId,
      provider,
      providerUserId,
    }: {
      userId: string;
      provider: OAuthProviderId;
      providerUserId: string;
    }) => {
      const link: OAuthAccountRow = {
        id: 'link-1',
        userId,
        provider,
        providerUserId,
        createdAt: new Date(),
      };
      created.link = link;
      return link;
    },
  } as unknown as OAuthAccountsRepository;

  const sessions: SessionManager = {
    issueSession: async (userId: string) => buildSession(userId),
  } as unknown as SessionManager;

  return { users, oauthAccounts, sessions, created };
};

describe('OAuthManager.signInOrRegister', () => {
  it('входит по существующей привязке без создания юзера', async () => {
    const existingLink: OAuthAccountRow = {
      id: 'link-existing',
      userId: 'user-existing',
      provider: 'yandex',
      providerUserId: 'yandex-42',
      createdAt: new Date(),
    };
    const fakes = buildFakes({ existingLink });
    const manager = new OAuthManager(fakes.users, fakes.oauthAccounts, fakes.sessions);

    const result = await manager.signInOrRegister({
      provider: 'yandex',
      providerUserId: 'yandex-42',
      email: 'someone@example.com',
    });

    expect(result).toEqual({ kind: 'session', sessionId: 'session-user-existing', userId: 'user-existing' });
    expect(fakes.created.user).toBeNull();
    expect(fakes.created.link).toBeNull();
  });

  it('создаёт нового пользователя и привязку, когда email свободен', async () => {
    const fakes = buildFakes({ existingLink: null, userByEmail: null });
    const manager = new OAuthManager(fakes.users, fakes.oauthAccounts, fakes.sessions);

    const result = await manager.signInOrRegister({
      provider: 'yandex',
      providerUserId: 'yandex-777',
      email: 'new@example.com',
    });

    expect(result.kind).toBe('session');
    expect(fakes.created.user?.email).toBe('new@example.com');
    expect(fakes.created.user?.passwordHash).toBeNull();
    expect(fakes.created.link?.provider).toBe('yandex');
    expect(fakes.created.link?.providerUserId).toBe('yandex-777');
  });

  it('возвращает email-taken, если email занят локальным юзером', async () => {
    const owner = buildUser({ email: 'taken@example.com' });
    const fakes = buildFakes({ existingLink: null, userByEmail: owner });
    const manager = new OAuthManager(fakes.users, fakes.oauthAccounts, fakes.sessions);

    const result = await manager.signInOrRegister({
      provider: 'yandex',
      providerUserId: 'yandex-1',
      email: 'taken@example.com',
    });

    expect(result).toEqual({ kind: 'email-taken' });
    expect(fakes.created.user).toBeNull();
    expect(fakes.created.link).toBeNull();
  });

  it('возвращает no-email, если провайдер не вернул email и привязки нет', async () => {
    const fakes = buildFakes({ existingLink: null, userByEmail: null });
    const manager = new OAuthManager(fakes.users, fakes.oauthAccounts, fakes.sessions);

    const result = await manager.signInOrRegister({
      provider: 'yandex',
      providerUserId: 'yandex-no-email',
      email: null,
    });

    expect(result).toEqual({ kind: 'no-email' });
    expect(fakes.created.user).toBeNull();
    expect(fakes.created.link).toBeNull();
  });
});

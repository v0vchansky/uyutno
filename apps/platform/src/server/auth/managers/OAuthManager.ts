import type { OAuthProviderId } from '../oauth/OAuthProvider';
import type { OAuthAccountsRepository } from '../repositories/oauthAccountsRepository';
import type { UsersRepository } from '../repositories/usersRepository';
import type { SessionManager } from './SessionManager';

export type OAuthSignInResult =
  { kind: 'session'; sessionId: string; userId: string } | { kind: 'email-taken' } | { kind: 'no-email' };

interface SignInParams {
  provider: OAuthProviderId;
  providerUserId: string;
  email: string | null;
  displayName: string | null;
}

export class OAuthManager {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly oauthAccountsRepository: OAuthAccountsRepository,
    private readonly sessionManager: SessionManager,
  ) {}

  async signInOrRegister(params: SignInParams): Promise<OAuthSignInResult> {
    const existingLink = await this.oauthAccountsRepository.findByProviderUser({
      provider: params.provider,
      providerUserId: params.providerUserId,
    });
    if (existingLink) {
      const session = await this.sessionManager.issueSession(existingLink.userId);
      return { kind: 'session', sessionId: session.id, userId: existingLink.userId };
    }

    if (!params.email) {
      return { kind: 'no-email' };
    }

    const emailOwner = await this.usersRepository.findByEmail(params.email);
    if (emailOwner) {
      return { kind: 'email-taken' };
    }

    const user = await this.usersRepository.create({
      email: params.email,
      passwordHash: null,
      displayName: params.displayName,
    });
    await this.oauthAccountsRepository.create({
      userId: user.id,
      provider: params.provider,
      providerUserId: params.providerUserId,
    });
    const session = await this.sessionManager.issueSession(user.id);
    return { kind: 'session', sessionId: session.id, userId: user.id };
  }
}

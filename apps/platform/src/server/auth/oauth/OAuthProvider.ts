export type OAuthProviderId = 'yandex' | 'vk';

export interface OAuthProfile {
  providerUserId: string;
  email: string | null;
  displayName: string | null;
}

export interface OAuthProvider {
  id: OAuthProviderId;
  getAuthorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthProfile>;
}

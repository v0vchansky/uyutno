import type { OAuthProviderId } from './OAuthProvider';

const DEV_BASE_URL = 'http://localhost:4000';

const readBaseUrl = (): string => {
  const raw = process.env.PUBLIC_BASE_URL?.trim();
  if (!raw) return DEV_BASE_URL;
  return raw.replace(/\/$/, '');
};

export const buildRedirectUri = (provider: OAuthProviderId): string => `${readBaseUrl()}/auth/callback/${provider}`;

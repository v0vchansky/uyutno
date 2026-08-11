import { ValidationError } from '@server/common';

import type { OAuthProfile, OAuthProvider } from './OAuthProvider';

const AUTHORIZE_URL = 'https://oauth.yandex.ru/authorize';
const TOKEN_URL = 'https://oauth.yandex.ru/token';
const USERINFO_URL = 'https://login.yandex.ru/info?format=json';

interface YandexTokenResponse {
  access_token?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
}

interface YandexUserInfoResponse {
  id?: unknown;
  default_email?: unknown;
  emails?: unknown;
  display_name?: unknown;
  first_name?: unknown;
  login?: unknown;
}

export class YandexProvider implements OAuthProvider {
  readonly id = 'yandex';

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  getAuthorizeUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      state,
      // Принудительно показываем экран согласия / выбора аккаунта,
      // иначе при активной сессии Passport Yandex ID молча возвращает код без UI.
      force_confirm: 'yes',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthProfile> {
    const accessToken = await this.exchangeToken(code, redirectUri);
    return this.fetchProfile(accessToken);
  }

  private async exchangeToken(code: string, redirectUri: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const payload = (await response.json().catch(() => null)) as YandexTokenResponse | null;

    if (!response.ok || !payload || typeof payload.access_token !== 'string') {
      const description = typeof payload?.error_description === 'string' ? payload.error_description : undefined;
      throw new ValidationError(description ?? 'Yandex OAuth: обмен кода на токен не удался');
    }

    return payload.access_token;
  }

  private async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `OAuth ${accessToken}` },
    });

    if (!response.ok) {
      throw new ValidationError('Yandex OAuth: не удалось получить профиль');
    }

    const payload = (await response.json().catch(() => null)) as YandexUserInfoResponse | null;
    if (!payload || typeof payload.id !== 'string' || payload.id.length === 0) {
      throw new ValidationError('Yandex OAuth: пустой профиль');
    }

    const email = extractEmail(payload);
    const displayName = extractDisplayName(payload);
    return { providerUserId: payload.id, email, displayName };
  }
}

const extractEmail = (payload: YandexUserInfoResponse): string | null => {
  if (typeof payload.default_email === 'string' && payload.default_email.length > 0) {
    return payload.default_email.trim().toLowerCase();
  }
  if (Array.isArray(payload.emails)) {
    const first = payload.emails.find((value): value is string => typeof value === 'string' && value.length > 0);
    if (first) return first.trim().toLowerCase();
  }
  return null;
};

const trimOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const extractDisplayName = (payload: {
  display_name?: unknown;
  first_name?: unknown;
  login?: unknown;
}): string | null => trimOrNull(payload.display_name) ?? trimOrNull(payload.first_name) ?? trimOrNull(payload.login);

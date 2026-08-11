import type { OAuthProvider, OAuthProviderId } from './OAuthProvider';
import { YandexProvider } from './YandexProvider';

export interface OAuthProviderRegistry {
  get(id: string): OAuthProvider | null;
  getEnabledIds(): OAuthProviderId[];
}

export const createOAuthProviderRegistry = (): OAuthProviderRegistry => {
  const providers = new Map<OAuthProviderId, OAuthProvider>();

  const yandex = tryCreateYandex();
  if (yandex) providers.set('yandex', yandex);

  return {
    get: (id: string): OAuthProvider | null => {
      if (id !== 'yandex' && id !== 'vk') return null;
      return providers.get(id) ?? null;
    },
    getEnabledIds: (): OAuthProviderId[] => Array.from(providers.keys()),
  };
};

const tryCreateYandex = (): YandexProvider | null => {
  const clientId = process.env.YANDEX_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.YANDEX_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.warn(
      '[oauth] YANDEX_OAUTH_CLIENT_ID/YANDEX_OAUTH_CLIENT_SECRET не заданы — Yandex-провайдер отключён (эндпоинты вернут 404).',
    );
    return null;
  }
  return new YandexProvider(clientId, clientSecret);
};

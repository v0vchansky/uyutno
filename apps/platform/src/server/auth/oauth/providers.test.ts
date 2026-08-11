import { createOAuthProviderRegistry } from './providers';

describe('createOAuthProviderRegistry', () => {
  const originalClientId = process.env.YANDEX_OAUTH_CLIENT_ID;
  const originalClientSecret = process.env.YANDEX_OAUTH_CLIENT_SECRET;

  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (originalClientId === undefined) delete process.env.YANDEX_OAUTH_CLIENT_ID;
    else process.env.YANDEX_OAUTH_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.YANDEX_OAUTH_CLIENT_SECRET;
    else process.env.YANDEX_OAUTH_CLIENT_SECRET = originalClientSecret;
  });

  it('без YANDEX_OAUTH_CLIENT_ID/SECRET реестр пуст и get(«yandex») возвращает null', () => {
    delete process.env.YANDEX_OAUTH_CLIENT_ID;
    delete process.env.YANDEX_OAUTH_CLIENT_SECRET;

    const registry = createOAuthProviderRegistry();

    expect(registry.getEnabledIds()).toEqual([]);
    expect(registry.get('yandex')).toBeNull();
  });

  it('с валидными YANDEX_OAUTH_CLIENT_ID/SECRET регистрирует yandex-провайдер', () => {
    process.env.YANDEX_OAUTH_CLIENT_ID = 'test-client-id';
    process.env.YANDEX_OAUTH_CLIENT_SECRET = 'test-client-secret';

    const registry = createOAuthProviderRegistry();

    expect(registry.getEnabledIds()).toEqual(['yandex']);
    const provider = registry.get('yandex');
    expect(provider).not.toBeNull();
    expect(provider?.id).toBe('yandex');
  });

  it('get() для неизвестного id всегда возвращает null', () => {
    process.env.YANDEX_OAUTH_CLIENT_ID = 'test-client-id';
    process.env.YANDEX_OAUTH_CLIENT_SECRET = 'test-client-secret';

    const registry = createOAuthProviderRegistry();

    expect(registry.get('facebook')).toBeNull();
    expect(registry.get('')).toBeNull();
  });
});

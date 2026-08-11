import { extractDisplayName, YandexProvider } from './YandexProvider';

describe('YandexProvider.getAuthorizeUrl', () => {
  const provider = new YandexProvider('client-id-123', 'client-secret-xyz');
  const url = provider.getAuthorizeUrl('state-abc', 'https://example.com/auth/oauth/yandex/callback');
  const parsed = new URL(url);

  it('ведёт на oauth.yandex.ru/authorize', () => {
    expect(parsed.origin + parsed.pathname).toBe('https://oauth.yandex.ru/authorize');
  });

  it('прокидывает базовые OAuth-параметры', () => {
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('client-id-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://example.com/auth/oauth/yandex/callback');
    expect(parsed.searchParams.get('state')).toBe('state-abc');
  });

  it('добавляет force_confirm=yes, чтобы Yandex показывал экран согласия/выбора аккаунта', () => {
    expect(parsed.searchParams.get('force_confirm')).toBe('yes');
    expect(url).toContain('force_confirm=yes');
  });
});

describe('YandexProvider.extractDisplayName', () => {
  it('берёт display_name, если он непустой', () => {
    expect(extractDisplayName({ display_name: 'Аня', first_name: 'Анна', login: 'anya' })).toBe('Аня');
  });

  it('фолбэчится на first_name, если display_name пустой', () => {
    expect(extractDisplayName({ display_name: '   ', first_name: 'Анна', login: 'anya' })).toBe('Анна');
    expect(extractDisplayName({ first_name: 'Анна', login: 'anya' })).toBe('Анна');
  });

  it('фолбэчится на login, если display_name и first_name пустые', () => {
    expect(extractDisplayName({ display_name: '', first_name: '   ', login: 'anya' })).toBe('anya');
    expect(extractDisplayName({ login: 'anya' })).toBe('anya');
  });

  it('возвращает null, если ни одно поле не заполнено', () => {
    expect(extractDisplayName({})).toBeNull();
    expect(extractDisplayName({ display_name: '   ', first_name: '', login: null })).toBeNull();
  });

  it('обрезает пробелы в результирующем значении', () => {
    expect(extractDisplayName({ display_name: '  Аня  ' })).toBe('Аня');
  });
});

import { extractDisplayName } from './YandexProvider';

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

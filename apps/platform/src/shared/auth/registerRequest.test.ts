import { registerRequestSchema } from './registerRequest';

describe('registerRequestSchema', () => {
  it('нормализует email (trim + lowercase)', () => {
    const parsed = registerRequestSchema.parse({
      email: '  User@Example.COM ',
      password: 'letmein42',
      displayName: 'Аня',
    });
    expect(parsed.email).toBe('user@example.com');
  });

  it('пропускает валидный пароль с буквами и цифрами', () => {
    expect(() =>
      registerRequestSchema.parse({ email: 'a@b.co', password: 'abcdefg1', displayName: 'Аня' }),
    ).not.toThrow();
  });

  it('отклоняет пароль короче 8 символов', () => {
    expect(() => registerRequestSchema.parse({ email: 'a@b.co', password: 'ab12', displayName: 'Аня' })).toThrow();
  });

  it('отклоняет пароль без цифр', () => {
    expect(() => registerRequestSchema.parse({ email: 'a@b.co', password: 'abcdefgh', displayName: 'Аня' })).toThrow();
  });

  it('отклоняет пароль без букв', () => {
    expect(() => registerRequestSchema.parse({ email: 'a@b.co', password: '12345678', displayName: 'Аня' })).toThrow();
  });

  it('отклоняет некорректный email', () => {
    expect(() =>
      registerRequestSchema.parse({ email: 'not-an-email', password: 'letmein42', displayName: 'Аня' }),
    ).toThrow();
  });

  it('обрезает пробелы у displayName', () => {
    const parsed = registerRequestSchema.parse({ email: 'a@b.co', password: 'letmein42', displayName: '  Аня  ' });
    expect(parsed.displayName).toBe('Аня');
  });

  it('отклоняет пустой displayName', () => {
    expect(() => registerRequestSchema.parse({ email: 'a@b.co', password: 'letmein42', displayName: '   ' })).toThrow();
  });

  it('отклоняет displayName длиннее 64 символов', () => {
    const long = 'а'.repeat(65);
    expect(() => registerRequestSchema.parse({ email: 'a@b.co', password: 'letmein42', displayName: long })).toThrow();
  });
});

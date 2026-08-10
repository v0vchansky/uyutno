import { registerRequestSchema } from './registerRequest';

describe('registerRequestSchema', () => {
  it('нормализует email (trim + lowercase)', () => {
    const parsed = registerRequestSchema.parse({ email: '  User@Example.COM ', password: 'letmein42' });
    expect(parsed.email).toBe('user@example.com');
  });

  it('пропускает валидный пароль с буквами и цифрами', () => {
    expect(() => registerRequestSchema.parse({ email: 'a@b.co', password: 'abcdefg1' })).not.toThrow();
  });

  it('отклоняет пароль короче 8 символов', () => {
    expect(() => registerRequestSchema.parse({ email: 'a@b.co', password: 'ab12' })).toThrow();
  });

  it('отклоняет пароль без цифр', () => {
    expect(() => registerRequestSchema.parse({ email: 'a@b.co', password: 'abcdefgh' })).toThrow();
  });

  it('отклоняет пароль без букв', () => {
    expect(() => registerRequestSchema.parse({ email: 'a@b.co', password: '12345678' })).toThrow();
  });

  it('отклоняет некорректный email', () => {
    expect(() => registerRequestSchema.parse({ email: 'not-an-email', password: 'letmein42' })).toThrow();
  });
});

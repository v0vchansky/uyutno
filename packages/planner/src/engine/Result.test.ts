import { err, ok, type Result } from './Result';

describe('Result', () => {
  it('ok/err — discriminated union по полю ok', () => {
    const success: Result<number, string> = ok(42);
    const failure: Result<number, string> = err('nope');
    expect(success).toEqual({ ok: true, value: 42 });
    expect(failure).toEqual({ ok: false, error: 'nope' });
    if (success.ok) expect(success.value).toBe(42);
    if (!failure.ok) expect(failure.error).toBe('nope');
  });

  it('ok(undefined) — валидный результат команды без значения', () => {
    expect(ok(undefined)).toEqual({ ok: true, value: undefined });
  });
});

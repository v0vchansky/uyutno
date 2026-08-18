import { COORDINATE_QUANTUM, quantize } from './quantize';

describe('quantize', () => {
  it('шаг квантования — 0.001 см (ADR 0016 B1)', () => {
    expect(COORDINATE_QUANTUM).toBe(0.001);
  });

  it('значение на сетке не меняется', () => {
    expect(quantize(0)).toBe(0);
    expect(quantize(1)).toBe(1);
    expect(quantize(12.345)).toBe(12.345);
    expect(quantize(-7.5)).toBe(-7.5);
  });

  it('округляет к ближайшему шагу без хвостов плавающей точки', () => {
    expect(quantize(0.1 + 0.2)).toBe(0.3);
    expect(quantize(12.3454)).toBe(12.345);
    expect(quantize(12.3456)).toBe(12.346);
    expect(quantize(1234567.8912345)).toBe(1234567.891);
  });

  it('порог половины шага: 0.0005 → вверх, чуть меньше → вниз', () => {
    expect(quantize(0.0005)).toBe(0.001);
    expect(quantize(0.00049)).toBe(0);
    expect(quantize(1.0015)).toBe(1.002);
    expect(quantize(1.00149)).toBe(1.001);
  });

  it('отрицательные: симметрично по модулю, кроме половины шага (Math.round → к +∞)', () => {
    expect(quantize(-12.3454)).toBe(-12.345);
    expect(quantize(-12.3456)).toBe(-12.346);
    expect(quantize(-0.0005)).toBe(0);
    expect(quantize(-0.00051)).toBe(-0.001);
  });

  it('нормализует -0 в 0', () => {
    expect(Object.is(quantize(-0), 0)).toBe(true);
    expect(Object.is(quantize(-0.0001), 0)).toBe(true);
  });

  it('NaN и ±Infinity пробрасывает как есть — отсекать обязана валидация команды', () => {
    expect(quantize(Number.NaN)).toBeNaN();
    expect(quantize(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(quantize(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('идемпотентна: quantize(quantize(x)) === quantize(x)', () => {
    for (const x of [0.1 + 0.2, 99.9995, -3.14159, 1e6 + 0.0004]) {
      expect(quantize(quantize(x))).toBe(quantize(x));
    }
  });
});

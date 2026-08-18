import { L_EPS, pointsMatch } from './pointsMatch';

describe('pointsMatch', () => {
  it('L_EPS = 1e-8 (ADR 0017 C3)', () => {
    expect(L_EPS).toBe(1e-8);
  });

  it('совпадающие и близкие ближе L_EPS по обеим осям — true', () => {
    expect(pointsMatch({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(pointsMatch({ x: 1, y: 2 }, { x: 1 + 1e-9, y: 2 - 1e-9 })).toBe(true);
  });

  it('порог строгий: ровно L_EPS по одной оси — false, чуть меньше — true', () => {
    expect(pointsMatch({ x: 0, y: 0 }, { x: L_EPS, y: 0 })).toBe(false);
    expect(pointsMatch({ x: 0, y: 0 }, { x: L_EPS * 0.99, y: 0 })).toBe(true);
    expect(pointsMatch({ x: 0, y: 0 }, { x: 0, y: L_EPS })).toBe(false);
  });

  it('метрика чебышёва, а не евклид: обе оси в допуске — true, даже если гипотенуза больше', () => {
    expect(pointsMatch({ x: 0, y: 0 }, { x: 0.9e-8, y: 0.9e-8 })).toBe(true);
    expect(pointsMatch({ x: 0, y: 0 }, { x: 0.9e-8, y: 1.1e-8 })).toBe(false);
  });

  it('свой accuracy', () => {
    expect(pointsMatch({ x: 0, y: 0 }, { x: 0.5, y: -0.5 }, 1)).toBe(true);
    expect(pointsMatch({ x: 0, y: 0 }, { x: 1, y: 0 }, 1)).toBe(false);
  });

  it('отрицательные координаты и NaN/Infinity', () => {
    expect(pointsMatch({ x: -5, y: -5 }, { x: -5, y: -5 })).toBe(true);
    expect(pointsMatch({ x: Number.NaN, y: 0 }, { x: 0, y: 0 })).toBe(false);
    expect(pointsMatch({ x: Number.POSITIVE_INFINITY, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 0 })).toBe(false);
  });
});

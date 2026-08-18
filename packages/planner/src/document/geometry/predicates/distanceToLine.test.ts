import { distanceToLine } from './distanceToLine';

describe('distanceToLine', () => {
  const A = { x: 0, y: 0 };
  const B = { x: 10, y: 0 };

  it('расстояние до бесконечной прямой, не до отрезка', () => {
    expect(distanceToLine({ x: 5, y: 3 }, A, B)).toBe(3);
    expect(distanceToLine({ x: 100, y: 3 }, A, B)).toBe(3);
    expect(distanceToLine({ x: -100, y: -3 }, A, B)).toBe(3);
  });

  it('всегда неотрицательное — по обе стороны прямой одинаково; порядок концов не важен', () => {
    expect(distanceToLine({ x: 5, y: -3 }, A, B)).toBe(3);
    expect(distanceToLine({ x: 5, y: -3 }, B, A)).toBe(3);
  });

  it('точка на прямой — 0; наклонная прямая', () => {
    expect(distanceToLine({ x: 7, y: 0 }, A, B)).toBe(0);
    expect(distanceToLine({ x: 0, y: 2 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(Math.SQRT2, 12);
  });

  it('гард вырожденной прямой: a == b — расстояние до точки a, не NaN', () => {
    expect(distanceToLine({ x: 3, y: 4 }, A, A)).toBe(5);
    expect(distanceToLine({ x: 3, y: 4 }, A, { x: 1e-9, y: 0 })).toBe(5);
  });

  it('NaN во входе — NaN', () => {
    expect(distanceToLine({ x: Number.NaN, y: 0 }, A, B)).toBeNaN();
  });
});

import { bisectorPoint } from './bisectorPoint';
import { euclDist } from './distance';

describe('bisectorPoint', () => {
  const O = { x: 0, y: 0 };

  it('прямой угол: биссектриса под 45°, длина ≤ 1', () => {
    const c = bisectorPoint(O, { x: 10, y: 0 }, { x: 0, y: 10 })!;
    expect(c.x).toBeCloseTo(0.5, 12);
    expect(c.y).toBeCloseTo(0.5, 12);
    expect(euclDist(O, c)).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('не зависит от длин лучей и порядка A/B; работает не в начале координат', () => {
    const o = { x: -5, y: 3 };
    const c1 = bisectorPoint(o, { x: 95, y: 3 }, { x: -5, y: 4 })!;
    const c2 = bisectorPoint(o, { x: -5, y: 1003 }, { x: -4, y: 3 })!;
    expect(c1.x).toBeCloseTo(c2.x, 12);
    expect(c1.y).toBeCloseTo(c2.y, 12);
  });

  it('сонаправленные лучи — точка на луче на расстоянии 1', () => {
    const c = bisectorPoint(O, { x: 5, y: 0 }, { x: 50, y: 0 })!;
    expect(c).toEqual({ x: 1, y: 0 });
  });

  it('противоположные лучи (развёрнутый угол) → null', () => {
    expect(bisectorPoint(O, { x: 5, y: 0 }, { x: -50, y: 0 })).toBeNull();
    expect(bisectorPoint(O, { x: 3, y: 4 }, { x: -3, y: -4 })).toBeNull();
  });

  it('вырожденный луч (A == O или B == O) → null, не NaN', () => {
    expect(bisectorPoint(O, O, { x: 1, y: 1 })).toBeNull();
    expect(bisectorPoint(O, { x: 1, y: 1 }, O)).toBeNull();
    expect(bisectorPoint(O, { x: Number.NaN, y: 1 }, { x: 1, y: 0 })).toBeNull();
  });
});

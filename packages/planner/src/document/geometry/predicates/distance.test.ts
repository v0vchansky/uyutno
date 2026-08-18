import * as fc from 'fast-check';

import { arbPoint, fcParams } from '../testing/arbitraries';
import { euclDist, manhDist } from './distance';

describe('manhDist / euclDist', () => {
  it('обычный случай: 3-4-5', () => {
    expect(euclDist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(manhDist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
  });

  it('совпадающие точки — 0; знак координат не влияет; симметричны', () => {
    expect(euclDist({ x: -1, y: -1 }, { x: -1, y: -1 })).toBe(0);
    expect(manhDist({ x: -1, y: -1 }, { x: -1, y: -1 })).toBe(0);
    expect(manhDist({ x: -3, y: 2 }, { x: 1, y: -2 })).toBe(8);
    expect(euclDist({ x: -3, y: 2 }, { x: 1, y: -2 })).toBe(euclDist({ x: 1, y: -2 }, { x: -3, y: 2 }));
  });

  it('property: манхэттен ≥ евклид ≥ манхэттен/√2, оба ≥ 0 и не NaN', () => {
    fc.assert(
      fc.property(arbPoint, arbPoint, (a, b) => {
        const e = euclDist(a, b);
        const m = manhDist(a, b);
        expect(Number.isNaN(e) || Number.isNaN(m)).toBe(false);
        expect(m).toBeGreaterThanOrEqual(e - 1e-9);
        expect(e).toBeGreaterThanOrEqual(m / Math.SQRT2 - 1e-9);
      }),
      fcParams,
    );
  });

  it('NaN/Infinity во входе — пробрасываются', () => {
    expect(euclDist({ x: Number.NaN, y: 0 }, { x: 0, y: 0 })).toBeNaN();
    expect(manhDist({ x: Number.POSITIVE_INFINITY, y: 0 }, { x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});

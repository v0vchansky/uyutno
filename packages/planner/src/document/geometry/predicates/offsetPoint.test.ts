import * as fc from 'fast-check';

import { arbPoint, fcParams } from '../testing/arbitraries';
import { euclDist } from './distance';
import { offsetPoint, offsetSegment } from './offsetPoint';
import { orient2d } from './orient2d';

describe('offsetPoint', () => {
  const O = { x: 0, y: 0 };

  it('направление +X: left — вверх (+y), right — вниз (−y) при y вверх', () => {
    expect(offsetPoint(O, { x: 10, y: 0 }, 3, 'left')).toEqual({ x: 0, y: 3 });
    expect(offsetPoint(O, { x: 10, y: 0 }, 3, 'right')).toEqual({ x: 0, y: -3 });
  });

  it('направление +Y: left — −x, right — +x; −X и −Y симметрично', () => {
    expect(offsetPoint(O, { x: 0, y: 10 }, 3, 'left')).toEqual({ x: -3, y: 0 });
    expect(offsetPoint(O, { x: 0, y: 10 }, 3, 'right')).toEqual({ x: 3, y: 0 });
    expect(offsetPoint(O, { x: -10, y: 0 }, 3, 'left')).toEqual({ x: 0, y: -3 });
    expect(offsetPoint(O, { x: 0, y: -10 }, 3, 'left')).toEqual({ x: 3, y: 0 });
  });

  it('нормаль нормированная: смещение ровно на distance независимо от длины отрезка', () => {
    const shifted = offsetPoint({ x: 1, y: 1 }, { x: 4, y: 5 }, 10, 'right')!;
    expect(euclDist(shifted, { x: 1, y: 1 })).toBeCloseTo(10, 12);
    expect(shifted.x).toBeCloseTo(1 + 8, 12); // (dy, −dx)/len · d = (4, −3)/5 · 10
    expect(shifted.y).toBeCloseTo(1 - 6, 12);
  });

  it('отрицательный distance = противоположная сторона', () => {
    expect(offsetPoint(O, { x: 10, y: 0 }, -3, 'left')).toEqual(offsetPoint(O, { x: 10, y: 0 }, 3, 'right'));
  });

  it('гард нулевой длины: a == b → null (не NaN); NaN во входе → null', () => {
    expect(offsetPoint(O, O, 3, 'left')).toBeNull();
    expect(offsetPoint(O, { x: 1e-9, y: 0 }, 3, 'left')).toBeNull();
    expect(offsetPoint(O, { x: Number.NaN, y: 0 }, 3, 'left')).toBeNull();
  });

  it('property: смещённая точка лежит слева/справа от a→b по orient2d и на расстоянии |distance|', () => {
    fc.assert(
      fc.property(arbPoint, arbPoint, fc.integer({ min: 1, max: 100 }), (a, b, d) => {
        fc.pre(euclDist(a, b) > 1);
        const left = offsetPoint(a, b, d, 'left')!;
        const right = offsetPoint(a, b, d, 'right')!;
        expect(orient2d(a, b, left)).toBeGreaterThan(0);
        expect(orient2d(a, b, right)).toBeLessThan(0);
        expect(euclDist(a, left)).toBeCloseTo(d, 6);
        expect(euclDist(a, right)).toBeCloseTo(d, 6);
      }),
      fcParams,
    );
  });
});

describe('offsetSegment', () => {
  it('оба конца смещаются на один вектор в сторону side от направления a→b', () => {
    expect(offsetSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 2, 'left')).toEqual([
      { x: 0, y: 2 },
      { x: 10, y: 2 },
    ]);
    expect(offsetSegment({ x: 10, y: 0 }, { x: 0, y: 0 }, 2, 'left')).toEqual([
      { x: 10, y: -2 },
      { x: 0, y: -2 },
    ]);
  });

  it('вырожденный отрезок → null', () => {
    expect(offsetSegment({ x: 1, y: 1 }, { x: 1, y: 1 }, 2, 'right')).toBeNull();
  });
});

import * as fc from 'fast-check';

import { arbPoint, fcParams } from '../testing/arbitraries';
import { faceNormal, shiftAlongNormal, shiftPoint } from './faceNormalShift';

describe('faceNormalShift — проекция смещения на нормаль грани (спека 01 «Перетаскивание стены»)', () => {
  it('нормаль горизонтальной грани a→b (вправо) — вверх (левая при y вверх), единичная', () => {
    expect(faceNormal({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ x: -0, y: 1 });
    expect(faceNormal({ x: 100, y: 0 }, { x: 0, y: 0 })).toEqual({ x: -0, y: -1 });
  });

  it('вырожденная грань — null', () => {
    expect(faceNormal({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
    expect(faceNormal({ x: 0, y: 0 }, { x: 1e-9, y: 0 })).toBeNull();
  });

  it('смещение вдоль грани не даёт сдвига, поперёк — весь; диагональ — только нормальная компонента', () => {
    const n = faceNormal({ x: 0, y: 0 }, { x: 100, y: 0 })!;
    expect(shiftAlongNormal(n, { x: 50, y: 0 })).toBe(0);
    expect(shiftAlongNormal(n, { x: 0, y: 7 })).toBe(7);
    expect(shiftAlongNormal(n, { x: 30, y: -4 })).toBe(-4);
    expect(shiftPoint({ x: 10, y: 20 }, n, -4)).toEqual({ x: 10, y: 16 });
  });

  it('property: нормаль единичная и перпендикулярна грани; сдвиг обоих концов сохраняет длину и направление грани', () => {
    fc.assert(
      fc.property(arbPoint, arbPoint, arbPoint, fc.double({ min: -500, max: 500, noNaN: true }), (a, b, delta, s) => {
        const n = faceNormal(a, b);
        fc.pre(n !== null);
        expect(Math.hypot(n!.x, n!.y)).toBeCloseTo(1, 9);
        expect(n!.x * (b.x - a.x) + n!.y * (b.y - a.y)).toBeCloseTo(0, 6);
        const shift = shiftAlongNormal(n!, delta);
        expect(Math.abs(shift)).toBeLessThanOrEqual(Math.hypot(delta.x, delta.y) + 1e-9);
        const a2 = shiftPoint(a, n!, s);
        const b2 = shiftPoint(b, n!, s);
        expect(b2.x - a2.x).toBeCloseTo(b.x - a.x, 6);
        expect(b2.y - a2.y).toBeCloseTo(b.y - a.y, 6);
      }),
      fcParams,
    );
  });
});

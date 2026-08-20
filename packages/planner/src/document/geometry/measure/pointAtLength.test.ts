import { euclDist } from '../predicates/distance';
import { COORDINATE_QUANTUM, quantize } from '../../quantize';
import { pointAtLength } from './pointAtLength';

describe('pointAtLength', () => {
  const O = { x: 0, y: 0 };

  it('горизонталь: 40 см вправо от начала направления', () => {
    expect(pointAtLength(O, { x: 1, y: 0 }, 40)).toEqual({ x: 40, y: 0 });
    expect(pointAtLength({ x: 10, y: -5 }, { x: 999, y: -5 }, 25)).toEqual({ x: 35, y: -5 });
  });

  it('вертикаль: длина откладывается по y, знак направления сохраняется', () => {
    expect(pointAtLength(O, { x: 0, y: 3 }, 120)).toEqual({ x: 0, y: 120 });
    expect(pointAtLength(O, { x: 0, y: -3 }, 120)).toEqual({ x: 0, y: -120 });
  });

  it('диагональ: направление 3-4-5 нормируется, длина откладывается по нему', () => {
    expect(pointAtLength(O, { x: 3, y: 4 }, 10)).toEqual({ x: 6, y: 8 });
  });

  it('length = 0 — сама точка `from`', () => {
    expect(pointAtLength({ x: 12.5, y: -7.25 }, { x: 100, y: 100 }, 0)).toEqual({ x: 12.5, y: -7.25 });
  });

  it('отрицательная длина — точка в обратную сторону от `towards`', () => {
    expect(pointAtLength(O, { x: 1, y: 0 }, -40)).toEqual({ x: -40, y: 0 });
    expect(pointAtLength(O, { x: 3, y: 4 }, -10)).toEqual({ x: -6, y: -8 });
  });

  it('вырожденное направление (`from` совпал с `towards`) → null', () => {
    expect(pointAtLength(O, O, 40)).toBeNull();
    expect(pointAtLength({ x: 5, y: 5 }, { x: 5, y: 5 }, 40)).toBeNull();
  });

  it('не-конечная длина (NaN / ±Infinity) → null', () => {
    expect(pointAtLength(O, { x: 1, y: 0 }, Number.NaN)).toBeNull();
    expect(pointAtLength(O, { x: 1, y: 0 }, Number.POSITIVE_INFINITY)).toBeNull();
    expect(pointAtLength(O, { x: 1, y: 0 }, Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it('не-конечные координаты направления → null', () => {
    expect(pointAtLength(O, { x: Number.NaN, y: 0 }, 40)).toBeNull();
    expect(pointAtLength({ x: 0, y: Number.NaN }, { x: 1, y: 0 }, 40)).toBeNull();
    expect(pointAtLength(O, { x: Number.POSITIVE_INFINITY, y: 0 }, 40)).toBeNull();
  });

  it('результат квантован до 0.001 см', () => {
    const p = pointAtLength(O, { x: 1, y: 1 }, 1)!;
    expect(p.x).toBe(quantize(p.x));
    expect(p.y).toBe(quantize(p.y));
    expect(p.x).toBe(0.707);
    expect(p.y).toBe(0.707);
  });

  it('длина результата от `from` равна |length| с точностью до кванта', () => {
    const cases: Array<[{ x: number; y: number }, number]> = [
      [{ x: 1, y: 0 }, 137.4],
      [{ x: -2, y: 7 }, 55],
      [{ x: 3, y: 4 }, -80.125],
      [{ x: -1, y: -1 }, 0.5],
    ];
    for (const [towards, length] of cases) {
      const p = pointAtLength({ x: 4, y: -9 }, towards, length)!;
      expect(euclDist({ x: 4, y: -9 }, p)).toBeCloseTo(Math.abs(length), 2);
      // Квантование двух координат смещает точку не более чем на квант по диагонали.
      expect(Math.abs(euclDist({ x: 4, y: -9 }, p) - Math.abs(length))).toBeLessThanOrEqual(
        COORDINATE_QUANTUM * Math.SQRT2,
      );
    }
  });
});

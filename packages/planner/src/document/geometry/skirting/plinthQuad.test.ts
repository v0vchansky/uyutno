import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { euclDist } from '../predicates/distance';
import { orient2d } from '../predicates/orient2d';
import { arbPoint, fcParams } from '../testing/arbitraries';
import { PLINTH_MAX_MITER, PLINTH_OFFSET, plinthQuad } from './plinthQuad';

/**
 * Кольцо `A → B → C → D` вдоль оси X: грань `B → C` лежит на `y = 0`, внутренняя сторона — `left` (+y).
 * `a` задаётся координатами предыдущей точки, `d` — следующей.
 */
const quad = (a: PlanPosition, d: PlanPosition, side: 'left' | 'right' = 'left') =>
  plinthQuad({ a, b: { x: 0, y: 0 }, c: { x: 100, y: 0 }, d, side });

describe('plinthQuad — константы', () => {
  it('отступ 1 см и предел митры 2 см — `d` и `maxDist = d * 2` из `createPlinths` референса', () => {
    expect(PLINTH_OFFSET).toBe(1);
    expect(PLINTH_MAX_MITER).toBe(2);
  });
});

describe('plinthQuad — форма и сторона', () => {
  it('прямой угол с обеих сторон: митра на расстоянии √2 от угла, квад — [B, C, Bx, Cx]', () => {
    // Квадрат против часовой (0,0) → (100,0) → (100,100) → (0,100): интерьер слева от B → C.
    const result = quad({ x: 0, y: 100 }, { x: 100, y: 100 })!;
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 100, y: 0 });
    expect(result[2]!.x).toBeCloseTo(1, 12);
    expect(result[2]!.y).toBeCloseTo(1, 12);
    expect(result[3]!.x).toBeCloseTo(99, 12);
    expect(result[3]!.y).toBeCloseTo(1, 12);
    expect(euclDist({ x: 0, y: 0 }, result[2]!)).toBeCloseTo(Math.SQRT2, 12);
  });

  it('сторона `right` зеркальна `left`: смещение уходит по другую сторону грани', () => {
    const left = quad({ x: 0, y: 100 }, { x: 100, y: 100 }, 'left')!;
    const right = quad({ x: 0, y: -100 }, { x: 100, y: -100 }, 'right')!;
    expect(left[2]!.y).toBeCloseTo(1, 12);
    expect(right[2]!.y).toBeCloseTo(-1, 12);
    // `left` — против часовой от направления B → C (orient2d > 0), `right` — по часовой.
    expect(orient2d({ x: 0, y: 0 }, { x: 100, y: 0 }, left[2]!)).toBeGreaterThan(0);
    expect(orient2d({ x: 0, y: 0 }, { x: 100, y: 0 }, right[2]!)).toBeLessThan(0);
  });

  it('B и C — копии, а не узлы входа: производное не тащит ссылки на точки снимка', () => {
    const b = { x: 0, y: 0 };
    const c = { x: 100, y: 0 };
    const result = plinthQuad({ a: { x: 0, y: 100 }, b, c, d: { x: 100, y: 100 }, side: 'left' })!;
    expect(result[0]).not.toBe(b);
    expect(result[1]).not.toBe(c);
    expect(result[0]).toEqual(b);
    expect(result[1]).toEqual(c);
  });
});

describe('plinthQuad — порог митры PLINTH_MAX_MITER', () => {
  /**
   * Точка митры у угла `B` лежит на прямой `y = PLINTH_OFFSET`, поэтому `|B, Bx| = hypot(t, 1)`, и ровно
   * `PLINTH_MAX_MITER` даёт `t = √3` — в рациональных координатах не выражается. Обе стороны порога
   * поэтому берутся пифагоровыми тройками, а точное равенство проверяется отдельным тестом ниже.
   */
  it('угол тупее 60°: митра сохраняется (|B, Bx| = 1.9437 < 2)', () => {
    // A = (8, 15): предыдущая грань A → B даёт Bx = ((L − a) / h, 1) = (25/15, 1) при a = −8, h = 15, L = 17.
    const result = quad({ x: 8, y: 15 }, { x: 100, y: 100 })!;
    expect(result[2]!.x).toBeCloseTo(25 / 15, 12);
    expect(euclDist({ x: 0, y: 0 }, result[2]!)).toBeLessThan(PLINTH_MAX_MITER);
    expect(euclDist({ x: 0, y: 0 }, result[2]!)).toBeCloseTo(Math.hypot(25 / 15, 1), 12);
  });

  it('угол острее 60°: плоский торец Bx = Bpc (|B, Bx| = √5 > 2)', () => {
    // A = (3, 4): Bx лёг бы в (2, 1) — дальше предела, поэтому берётся смещённый конец самой грани.
    const result = quad({ x: 3, y: 4 }, { x: 100, y: 100 })!;
    expect(result[2]!.x).toBeCloseTo(0, 12);
    expect(result[2]!.y).toBeCloseTo(1, 12);
  });

  it('ровно на пороге (60°): решение совпадает с формулой `|B, Bx| <= PLINTH_MAX_MITER`', () => {
    // A = (1/√3, 1) даёт биссектрису с выносом ровно 2 — точного представления в double нет, поэтому
    // тест фиксирует не сторону порога, а его включительность: на границе митра ещё берётся.
    const result = quad({ x: 1 / Math.sqrt(3), y: 1 }, { x: 100, y: 100 })!;
    const distance = euclDist({ x: 0, y: 0 }, result[2]!);
    const flat = Math.abs(result[2]!.x) < 1e-9 && Math.abs(result[2]!.y - 1) < 1e-9;
    expect(flat ? Math.hypot(Math.sqrt(3), 1) : distance).toBeCloseTo(PLINTH_MAX_MITER, 9);
    expect(flat || distance <= PLINTH_MAX_MITER).toBe(true);
  });
});

describe('plinthQuad — вырожденные входы', () => {
  it('развёрнутый угол (соседи коллинеарны): пересечения нет, оба конца — плоские торцы', () => {
    const result = quad({ x: -100, y: 0 }, { x: 200, y: 0 })!;
    expect(result[2]).toEqual({ x: 0, y: 1 });
    expect(result[3]).toEqual({ x: 100, y: 1 });
  });

  it('почти прямая грань (соседи в 0.001° от коллинеарности): митра остаётся в пределах порога', () => {
    const result = quad({ x: -100, y: 0.002 }, { x: 200, y: 0.002 })!;
    expect(euclDist({ x: 0, y: 0 }, result[2]!)).toBeLessThanOrEqual(PLINTH_MAX_MITER);
    expect(result[2]!.y).toBeCloseTo(1, 6);
  });

  it('вырожденная соседняя грань (a == b): митры нет, берётся плоский торец', () => {
    const result = quad({ x: 0, y: 0 }, { x: 100, y: 100 })!;
    expect(result[2]).toEqual({ x: 0, y: 1 });
    expect(result[3]!.x).toBeCloseTo(99, 12);
  });

  it('вырожденная сама грань (b == c) → null: свипить нечего', () => {
    expect(
      plinthQuad({ a: { x: 0, y: 10 }, b: { x: 5, y: 5 }, c: { x: 5, y: 5 }, d: { x: 10, y: 0 }, side: 'left' }),
    ).toBeNull();
    expect(
      plinthQuad({ a: { x: 0, y: 10 }, b: { x: 0, y: 0 }, c: { x: 1e-9, y: 0 }, d: { x: 10, y: 0 }, side: 'left' }),
    ).toBeNull();
  });
});

describe('plinthQuad — property (fast-check, фиксированный seed)', () => {
  it('нет NaN/Infinity; Bx/Cx не дальше PLINTH_MAX_MITER от своих углов; B и C — сами концы грани', () => {
    fc.assert(
      fc.property(arbPoint, arbPoint, arbPoint, arbPoint, (a, b, c, d) => {
        const result = plinthQuad({ a, b, c, d, side: 'left' });
        if (result === null) return;
        for (const point of result) expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
        expect(result[0]).toEqual({ x: b.x, y: b.y });
        expect(result[1]).toEqual({ x: c.x, y: c.y });
        expect(euclDist(b, result[2]!)).toBeLessThanOrEqual(PLINTH_MAX_MITER + 1e-9);
        expect(euclDist(c, result[3]!)).toBeLessThanOrEqual(PLINTH_MAX_MITER + 1e-9);
      }),
      fcParams,
    );
  });
});

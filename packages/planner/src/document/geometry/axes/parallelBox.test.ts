import type { PlanPosition } from '../../PlannerDocument';
import { PARALLEL_EPS } from '../predicates/angleBetweenLines';
import { euclDist } from '../predicates/distance';
import { distanceToLine } from '../predicates/distanceToLine';
import { type ParallelBox, parallelBox } from './parallelBox';

const p = (x: number, y: number): PlanPosition => ({ x, y });
const A = p(0, 0);
const B = p(100, 0);

const expectPoint = (actual: PlanPosition | undefined, expected: PlanPosition): void => {
  expect(actual).toBeDefined();
  expect(actual!.x).toBeCloseTo(expected.x, 9);
  expect(actual!.y).toBeCloseTo(expected.y, 9);
};

const expectBox = (box: ParallelBox | null, expected: PlanPosition[]): void => {
  expect(box).not.toBeNull();
  expected.forEach((point, i) => expectPoint(box![i], point));
};

describe('parallelBox', () => {
  describe('четыре случая по проекциям C, D на отрезок AB', () => {
    it('обе внутри: [projC, projD], ближняя к A — первой (C ближе)', () => {
      expectBox(parallelBox(A, B, p(20, 10), p(80, 10)), [p(20, 0), p(80, 0), p(80, 10), p(20, 10)]);
    });

    it('обе внутри: D ближе к A → E = projD, F = projC', () => {
      expectBox(parallelBox(A, B, p(80, 10), p(20, 10)), [p(20, 0), p(80, 0), p(80, 10), p(20, 10)]);
    });

    it('обе снаружи, CD накрывает AB → [A, B]; в любом направлении CD', () => {
      expectBox(parallelBox(A, B, p(-50, 10), p(150, 10)), [p(0, 0), p(100, 0), p(100, 10), p(0, 10)]);
      expectBox(parallelBox(A, B, p(150, 10), p(-50, 10)), [p(0, 0), p(100, 0), p(100, 10), p(0, 10)]);
    });

    it('обе снаружи с одной стороны → null (справа и слева от AB)', () => {
      expect(parallelBox(A, B, p(150, 10), p(250, 10))).toBeNull();
      expect(parallelBox(A, B, p(-250, 10), p(-150, 10))).toBeNull();
    });

    it('только C внутри, ad > bd (D за B) → [projC, B]', () => {
      expectBox(parallelBox(A, B, p(50, 10), p(150, 10)), [p(50, 0), p(100, 0), p(100, 10), p(50, 10)]);
    });

    it('только C внутри, ad < bd (D за A) → [A, projC]', () => {
      expectBox(parallelBox(A, B, p(50, 10), p(-50, 10)), [p(0, 0), p(50, 0), p(50, 10), p(0, 10)]);
    });

    it('только D внутри, ac > bc (C за B) → [projD, B]', () => {
      expectBox(parallelBox(A, B, p(150, 10), p(50, 10)), [p(50, 0), p(100, 0), p(100, 10), p(50, 10)]);
    });

    it('только D внутри, ac < bc (C за A) → [A, projD]', () => {
      expectBox(parallelBox(A, B, p(-50, 10), p(50, 10)), [p(0, 0), p(50, 0), p(50, 10), p(0, 10)]);
    });
  });

  describe('параллельность', () => {
    it('угол больше PARALLEL_EPS → null', () => {
      const d = p(100, 10 + 100 * Math.tan(PARALLEL_EPS + 0.001));
      expect(parallelBox(A, B, p(0, 10), d)).toBeNull();
    });

    it('угол чуть меньше PARALLEL_EPS → бокс есть, G и H лежат на прямой CD', () => {
      const c = p(0, 10);
      const d = p(100, 10 + 100 * Math.tan(PARALLEL_EPS - 0.001));
      const box = parallelBox(A, B, c, d);
      expect(box).not.toBeNull();
      const [e, f, g, h] = box!;
      expectPoint(e, A);
      expectPoint(f, B);
      expect(distanceToLine(g, c, d)).toBeCloseTo(0, 9);
      expect(distanceToLine(h, c, d)).toBeCloseTo(0, 9);
    });

    it('свой maxAngle: широкий допуск принимает, узкий отвергает', () => {
      const d = p(100, 10 + 100 * Math.tan(0.2));
      expect(parallelBox(A, B, p(0, 10), d, 0.3)).not.toBeNull();
      expect(parallelBox(A, B, p(0, 10), d, 0.1)).toBeNull();
    });

    it('противонаправленная CD — тоже параллельна', () => {
      expect(parallelBox(A, B, p(80, 10), p(20, 10))).not.toBeNull();
    });
  });

  describe('вырожденные', () => {
    it('касание концами (CD начинается там, где заканчивается AB) → null', () => {
      expect(parallelBox(A, B, p(100, 10), p(200, 10))).toBeNull();
      expect(parallelBox(A, B, p(200, 10), p(100, 10))).toBeNull();
      expect(parallelBox(A, B, p(-100, 10), p(0, 10))).toBeNull();
    });

    it('перекрытие чуть длиннее L_EPS — уже бокс', () => {
      const box = parallelBox(A, B, p(99.9999, 10), p(200, 10));
      expect(box).not.toBeNull();
      expect(euclDist(box![0], box![1])).toBeCloseTo(0.0001, 6);
    });

    it('вырожденное AB (a === b) → null для любой CD', () => {
      expect(parallelBox(A, A, p(0, 10), p(100, 10))).toBeNull();
      expect(parallelBox(A, A, p(10, 0), p(10, 100))).toBeNull();
    });

    it('вырожденное CD (c === d) → null', () => {
      expect(parallelBox(A, B, p(50, 10), p(50, 10))).toBeNull();
    });

    it('NaN во входе → null', () => {
      expect(parallelBox(A, B, p(Number.NaN, 10), p(50, 10))).toBeNull();
    });
  });

  describe('свойства бокса', () => {
    it('E ближе к A, чем F', () => {
      for (const [c, d] of [
        [p(80, 10), p(20, 10)],
        [p(150, 10), p(-50, 10)],
        [p(50, 10), p(-50, 10)],
        [p(150, 10), p(50, 10)],
      ] as const) {
        const box = parallelBox(A, B, c, d)!;
        expect(euclDist(A, box[0])).toBeLessThan(euclDist(A, box[1]));
      }
    });

    it('точно параллельный вход — прямоугольник: H = проекция E, G = проекция F, стороны перпендикулярны', () => {
      const box = parallelBox(p(0, 0), p(60, 80), p(-8, 6), p(52, 86))!;
      const [e, f, g, h] = box;
      expect(distanceToLine(g, p(-8, 6), p(52, 86))).toBeCloseTo(0, 9);
      expect(distanceToLine(h, p(-8, 6), p(52, 86))).toBeCloseTo(0, 9);
      // EH ⟂ EF, FG ⟂ EF, |EH| = |FG| = 10.
      const dot = (u: PlanPosition, v: PlanPosition, w: PlanPosition) =>
        (v.x - u.x) * (w.x - u.x) + (v.y - u.y) * (w.y - u.y);
      expect(dot(e, f, h)).toBeCloseTo(0, 9);
      expect(dot(f, e, g)).toBeCloseTo(0, 9);
      expect(euclDist(e, h)).toBeCloseTo(10, 9);
      expect(euclDist(f, g)).toBeCloseTo(10, 9);
      expect(euclDist(e, f)).toBeCloseTo(euclDist(g, h), 9);
    });

    it('E, F — новые объекты, даже когда совпадают с A, B; вход не мутируется', () => {
      const a = p(0, 0);
      const b = p(100, 0);
      const c = p(-50, 10);
      const d = p(150, 10);
      const box = parallelBox(a, b, c, d)!;
      expect(box[0]).toEqual(a);
      expect(box[0]).not.toBe(a);
      expect(box[1]).toEqual(b);
      expect(box[1]).not.toBe(b);
      expect([a, b, c, d]).toEqual([p(0, 0), p(100, 0), p(-50, 10), p(150, 10)]);
    });

    it('CD с той же стороны, что и AB (совпадающие прямые) — бокс нулевой высоты', () => {
      const box = parallelBox(A, B, p(20, 0), p(80, 0))!;
      expectBox(box, [p(20, 0), p(80, 0), p(80, 0), p(20, 0)]);
    });
  });
});

import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { B_EPS } from '../predicates/pointOnSegment';
import { arbQuantizedPoint, fcParams } from '../testing/arbitraries';
import { type Segment, ringSegments } from './candidates';
import { findNearSegments } from './findNearSegments';

const p = (x: number, y: number): PlanPosition => ({ x, y });
const seg = (a: PlanPosition, b: PlanPosition): Segment => ({ a, b });

describe('findNearSegments', () => {
  // Квадрат-контур: (0,0) → (100,0) → (100,100) → (0,100).
  const A = p(0, 0);
  const B = p(100, 0);
  const C = p(100, 100);
  const D = p(0, 100);
  const square = ringSegments([A, B, C, D]);

  it('точка = вершина степени 2 → два «других» конца в порядке рёбер', () => {
    // Рёбра с A: [A→B] (первое, другой конец B) и [D→A] (последнее, другой конец D).
    expect(findNearSegments(p(0, 0), square)).toEqual([B, D]);
    // Вершина B: рёбра [A→B] → A, [B→C] → C.
    expect(findNearSegments(p(100, 0), square)).toEqual([A, C]);
  });

  it('порядок — как в списке рёбер, а не по геометрии', () => {
    const reversed = [seg(D, A), seg(A, B)];
    expect(findNearSegments(A, reversed)).toEqual([D, B]);
    expect(findNearSegments(A, [seg(A, B), seg(D, A)])).toEqual([B, D]);
  });

  it('вершина степени 1 (конец открытой цепочки) → null', () => {
    const chain = [seg(A, B), seg(B, C)];
    expect(findNearSegments(A, chain)).toBeNull();
    expect(findNearSegments(C, chain)).toBeNull();
    expect(findNearSegments(B, chain)).toEqual([A, C]);
  });

  it('вершина степени 4 (общая вершина двух контуров) → null', () => {
    const E = p(200, 0);
    const F = p(200, 100);
    const second = ringSegments([B, E, F, C]);
    // B — вершина обоих квадратов: рёбра A→B, B→C, B→E, C→B — четыре совпадения.
    expect(findNearSegments(B, [...square, ...second])).toBeNull();
  });

  it('вершина степени 3 → null', () => {
    const T = [seg(A, B), seg(B, C), seg(B, p(100, -100))];
    expect(findNearSegments(B, T)).toBeNull();
  });

  it('точка внутри ребра → его концы (в порядке a, b)', () => {
    expect(findNearSegments(p(50, 0), square)).toEqual([A, B]);
    expect(findNearSegments(p(100, 30), square)).toEqual([B, C]);
    expect(findNearSegments(p(0, 70), square)).toEqual([D, A]);
  });

  it('точка на двух рёбрах сразу (пересечение, не вершина) → null', () => {
    const cross = [seg(p(-100, 0), p(100, 0)), seg(p(0, -100), p(0, 100))];
    expect(findNearSegments(p(0, 0), cross)).toBeNull();
  });

  it('точка на двух совпадающих (дублирующихся) рёбрах → null', () => {
    expect(findNearSegments(p(50, 0), [seg(A, B), seg(A, B)])).toBeNull();
  });

  it('ничего рядом → null', () => {
    expect(findNearSegments(p(50, 50), square)).toBeNull();
    expect(findNearSegments(p(500, 500), square)).toBeNull();
  });

  it('пустой список → null', () => {
    expect(findNearSegments(p(0, 0), [])).toBeNull();
  });

  it('B_EPS у вершины: 0.99·B_EPS (манхэттен) — как вершина; ровно B_EPS — уже не вершина, но на ребре → ребро', () => {
    // Смещение по x вдоль ребра A→B: манхэттен = смещение.
    expect(findNearSegments(p(0.99 * B_EPS, 0), square)).toEqual([B, D]);
    // Ровно B_EPS — не «< B_EPS», вершиной не считается (ответ уже не [B, D]).
    expect(findNearSegments(p(B_EPS, 0), square)).not.toEqual([B, D]);
    // 1.01·B_EPS — не вершина, лежит на ребре A→B (до D→A поперёк 1.01·B_EPS — мимо) → концы A→B.
    expect(findNearSegments(p(1.01 * B_EPS, 0), square)).toEqual([A, B]);
  });

  it('B_EPS у вершины поперёк ребра: 1.01·B_EPS от вершины и мимо всех рёбер → null', () => {
    // Смещение по диагонали наружу от A: не на ребре A→B (поперёк 0.6·B_EPS·… нет — берём чётко больше).
    expect(findNearSegments(p(-2 * B_EPS, -2 * B_EPS), square)).toBeNull();
    // Смещение вдоль обоих рёбер по чуть-чуть: манхэттен 1.2·B_EPS ≥ B_EPS — не вершина; поперёк каждого ребра
    // 0.6·B_EPS < B_EPS — лежит на обоих → null (два ребра).
    expect(findNearSegments(p(0.6 * B_EPS, 0.6 * B_EPS), square)).toBeNull();
  });

  it('B_EPS поперёк ребра: 0.99·B_EPS — на ребре, ровно B_EPS — нет', () => {
    expect(findNearSegments(p(50, 0.99 * B_EPS), square)).toEqual([A, B]);
    expect(findNearSegments(p(50, B_EPS), square)).toBeNull();
    expect(findNearSegments(p(50, -B_EPS), square)).toBeNull();
  });

  it('вершина, но координаты кандидата отдельным объектом (совпадение по значению)', () => {
    expect(findNearSegments({ x: 100, y: 100 }, square)).toEqual([B, D]);
  });

  it('вырожденное ребро (a == b) в точке даёт одно совпадение (else-ветка не срабатывает)', () => {
    // Одно ребро — одно совпадение → степень 1 → null; вместе с A→B — степень 2 → [A, B].
    expect(findNearSegments(A, [seg(A, A)])).toBeNull();
    expect(findNearSegments(A, [seg(A, A), seg(A, B)])).toEqual([A, B]);
  });

  it('NaN в точке → null', () => {
    expect(findNearSegments(p(Number.NaN, 0), square)).toBeNull();
  });

  it('property: вершина произвольного кольца (≥ 3 различных вершин, без самопересечений в вершине) → соседи по кольцу', () => {
    fc.assert(
      fc.property(fc.array(arbQuantizedPoint, { minLength: 3, maxLength: 8 }), fc.nat(), (points, seed) => {
        const index = seed % points.length;
        const vertex = points[index]!;
        const segments = ringSegments(points);
        const result = findNearSegments(vertex, segments);
        // Число совпадений с вершиной по манхэттену < B_EPS среди концов рёбер.
        const hits = segments.filter(
          ({ a, b }) =>
            Math.abs(a.x - vertex.x) + Math.abs(a.y - vertex.y) < B_EPS ||
            Math.abs(b.x - vertex.x) + Math.abs(b.y - vertex.y) < B_EPS,
        ).length;
        if (hits === 2) {
          expect(result).not.toBeNull();
          const [first, second] = result!;
          const prev = points[(index - 1 + points.length) % points.length]!;
          const next = points[(index + 1) % points.length]!;
          // Порядок рёбер: ребро index (vertex→next) раньше ребра index−1 (prev→vertex), кроме index = 0.
          if (index === 0) {
            expect(first).toBe(next);
            expect(second).toBe(prev);
          } else {
            expect(first).toBe(prev);
            expect(second).toBe(next);
          }
        } else {
          expect(result).toBeNull();
        }
      }),
      fcParams,
    );
  });
});

import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { arbQuantizedPoint, fcParams } from '../testing/arbitraries';
import {
  DRAFT_ID_PREFIX,
  NO_ALIGNERS,
  type SnapCandidate,
  cullCandidates,
  draftCandidates,
  ringNeighbours,
  ringSegments,
} from './candidates';

const p = (x: number, y: number): PlanPosition => ({ x, y });
const c = (id: string, x: number, y: number): SnapCandidate => ({ id, x, y });

describe('candidates', () => {
  it('константы', () => {
    expect(DRAFT_ID_PREFIX).toBe('draft:');
    expect(NO_ALIGNERS).toEqual([null, null]);
  });

  describe('cullCandidates', () => {
    const bounds = { minX: -100, maxX: 100, minY: -50, maxY: 50 };

    it('внутри и на границе — остаются, снаружи и NaN — выкидываются, порядок сохранён', () => {
      const inside = c('in', 0, 0);
      const onEdge = c('edge', 100, -50);
      const outsideX = c('outX', 100.001, 0);
      const outsideY = c('outY', 0, 50.001);
      const nan = c('nan', Number.NaN, 0);
      expect(cullCandidates([outsideX, inside, nan, onEdge, outsideY], bounds)).toEqual([inside, onEdge]);
    });

    it('пустой список → []', () => {
      expect(cullCandidates([], bounds)).toEqual([]);
    });

    it('сохраняет ссылки на кандидатов (не копирует)', () => {
      const inside = c('in', 1, 1);
      expect(cullCandidates([inside], bounds)[0]).toBe(inside);
    });
  });

  describe('draftCandidates', () => {
    it('пустой список → []', () => {
      expect(draftCandidates([])).toEqual([]);
    });

    it('id `draft:<i>`, координаты скопированы (не ссылка на точку)', () => {
      const points = [p(0, 0), p(10, 0), p(10, 10)];
      const result = draftCandidates(points);
      expect(result.map(candidate => candidate.id)).toEqual(['draft:0', 'draft:1', 'draft:2']);
      expect(result[1]!.x).toBe(10);
      expect(result[1]!.y).toBe(0);
      expect(result[1]).not.toBe(points[1]);
      points[1]!.x = 999;
      expect(result[1]!.x).toBe(10);
    });

    it('открытая полилиния: соседи только у внутренних точек', () => {
      const points = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
      const result = draftCandidates(points);
      expect(result[0]!.prev).toBeUndefined();
      expect(result[0]!.next).toBeUndefined();
      expect(result[1]!.prev).toBe(points[0]);
      expect(result[1]!.next).toBe(points[2]);
      expect(result[2]!.prev).toBe(points[1]);
      expect(result[2]!.next).toBe(points[3]);
      expect(result[3]!.prev).toBeUndefined();
      expect(result[3]!.next).toBeUndefined();
    });

    it('открытая полилиния из двух точек / одной точки — ни у кого нет соседей', () => {
      draftCandidates([p(0, 0), p(10, 0)]).forEach(candidate => {
        expect(candidate.prev).toBeUndefined();
        expect(candidate.next).toBeUndefined();
      });
      expect(draftCandidates([p(0, 0)])[0]).toEqual({ id: 'draft:0', x: 0, y: 0 });
    });

    it('без соседей ключи prev/next отсутствуют (не undefined-значения)', () => {
      const [only] = draftCandidates([p(1, 2)]);
      expect(Object.keys(only!)).toEqual(['id', 'x', 'y']);
    });

    it('property: длина и id совпадают с индексами, координаты равны входу', () => {
      fc.assert(
        fc.property(fc.array(arbQuantizedPoint, { maxLength: 8 }), points => {
          const result = draftCandidates(points);
          expect(result).toHaveLength(points.length);
          result.forEach((candidate, index) => {
            expect(candidate.id).toBe(`draft:${index}`);
            expect(candidate.x).toBe(points[index]!.x);
            expect(candidate.y).toBe(points[index]!.y);
          });
        }),
        fcParams,
      );
    });
  });

  describe('ringNeighbours', () => {
    const ring = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];

    it('кольцо < 3 вершин → null (0, 1, 2)', () => {
      expect(ringNeighbours([], 0, true)).toBeNull();
      expect(ringNeighbours([p(0, 0)], 0, true)).toBeNull();
      expect(ringNeighbours([p(0, 0), p(1, 1)], 0, true)).toBeNull();
      expect(ringNeighbours([p(0, 0), p(1, 1)], 1, true)).toBeNull();
    });

    it('кольцо: wrap-around для индексов 0 и last', () => {
      expect(ringNeighbours(ring, 0, true)).toEqual({ prev: ring[3], next: ring[1] });
      expect(ringNeighbours(ring, 3, true)).toEqual({ prev: ring[2], next: ring[0] });
    });

    it('кольцо: внутренняя вершина', () => {
      expect(ringNeighbours(ring, 1, true)).toEqual({ prev: ring[0], next: ring[2] });
      expect(ringNeighbours(ring, 2, true)).toEqual({ prev: ring[1], next: ring[3] });
    });

    it('кольцо из ровно 3 вершин — соседи у всех', () => {
      const tri = [p(0, 0), p(10, 0), p(0, 10)];
      expect(ringNeighbours(tri, 0, true)).toEqual({ prev: tri[2], next: tri[1] });
      expect(ringNeighbours(tri, 1, true)).toEqual({ prev: tri[0], next: tri[2] });
      expect(ringNeighbours(tri, 2, true)).toEqual({ prev: tri[1], next: tri[0] });
    });

    it('полилиния: концы → null, внутренние — соседи по индексам', () => {
      expect(ringNeighbours(ring, 0, false)).toBeNull();
      expect(ringNeighbours(ring, 3, false)).toBeNull();
      expect(ringNeighbours(ring, 1, false)).toEqual({ prev: ring[0], next: ring[2] });
      expect(ringNeighbours(ring, 2, false)).toEqual({ prev: ring[1], next: ring[3] });
    });

    it('полилиния из 1–2 точек → null', () => {
      expect(ringNeighbours([p(0, 0)], 0, false)).toBeNull();
      expect(ringNeighbours([p(0, 0), p(1, 0)], 0, false)).toBeNull();
      expect(ringNeighbours([p(0, 0), p(1, 0)], 1, false)).toBeNull();
    });

    it('возвращает ссылки на точки массива, не копии', () => {
      const result = ringNeighbours(ring, 1, false)!;
      expect(result.prev).toBe(ring[0]);
      expect(result.next).toBe(ring[2]);
    });
  });

  describe('ringSegments', () => {
    it('0 и 1 вершина → []', () => {
      expect(ringSegments([])).toEqual([]);
      expect(ringSegments([p(0, 0)])).toEqual([]);
    });

    it('2 вершины → одно ребро (без замыкания-дубля)', () => {
      const a = p(0, 0);
      const b = p(10, 0);
      expect(ringSegments([a, b])).toEqual([{ a, b }]);
    });

    it('3 вершины → 3 ребра с замыканием на первую', () => {
      const tri = [p(0, 0), p(10, 0), p(0, 10)];
      expect(ringSegments(tri)).toEqual([
        { a: tri[0], b: tri[1] },
        { a: tri[1], b: tri[2] },
        { a: tri[2], b: tri[0] },
      ]);
    });

    it('4 вершины → 4 ребра, последнее замыкается на первую', () => {
      const ring = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
      const segments = ringSegments(ring);
      expect(segments).toHaveLength(4);
      expect(segments[3]).toEqual({ a: ring[3], b: ring[0] });
    });

    it('property: n ≥ 3 вершин → n рёбер, каждое ребро начинается там, где кончается предыдущее', () => {
      fc.assert(
        fc.property(fc.array(arbQuantizedPoint, { minLength: 3, maxLength: 10 }), points => {
          const segments = ringSegments(points);
          expect(segments).toHaveLength(points.length);
          segments.forEach((segment, index) => {
            expect(segment.a).toBe(points[index]);
            expect(segment.b).toBe(segments[(index + 1) % segments.length]!.a);
          });
        }),
        fcParams,
      );
    });
  });
});

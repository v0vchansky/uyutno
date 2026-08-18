import * as fc from 'fast-check';

import type { PlanPosition } from '../../PlannerDocument';
import { arbConvexPolygon, fcParams } from '../testing/arbitraries';
import { type Triangulation, triangulateContours } from './triangulateContours';

const p = (x: number, y: number): PlanPosition => ({ x, y });
/** Квадрат со стороной `s` и левым нижним углом `(x0, y0)`, против часовой. */
const square = (x0: number, y0: number, s: number): PlanPosition[] => [
  p(x0, y0),
  p(x0 + s, y0),
  p(x0 + s, y0 + s),
  p(x0, y0 + s),
];
const outerSquare = square(0, 0, 100);
const leftHalf = [p(0, 0), p(50, 0), p(50, 100), p(0, 100)];

const vertexKey = (v: PlanPosition): string => `${v.x}|${v.y}`;
const findVertex = ({ vertices }: Triangulation, x: number, y: number): number =>
  vertices.findIndex(v => v.x === x && v.y === y);
const edgeBetween = (t: Triangulation, x1: number, y1: number, x2: number, y2: number) => {
  const i = findVertex(t, x1, y1);
  const j = findVertex(t, x2, y2);
  return t.edges.find(e => e.a === Math.min(i, j) && e.b === Math.max(i, j));
};

/** Инварианты структуры half-edge-lite (проверяются на каждой триангуляции). */
const expectStructureInvariants = (t: Triangulation): void => {
  for (const edge of t.edges) {
    expect(edge.a).toBeLessThan(edge.b);
    expect(edge.triangles.length === 1 || edge.triangles.length === 2).toBe(true);
  }
  expect(t.triangleEdges).toHaveLength(t.triangles.length);
  t.triangles.forEach((triangle, ti) => {
    const sides = t.triangleEdges[ti]!;
    for (let i = 0; i < 3; i++) {
      const a = triangle[i]!;
      const b = triangle[(i + 1) % 3]!;
      const edge = t.edges[sides[i]!]!;
      expect([edge.a, edge.b]).toEqual([Math.min(a, b), Math.max(a, b)]);
      expect(edge.triangles).toContain(ti);
    }
  });
  for (const v of t.vertices) {
    expect(Number.isNaN(v.x) || Number.isNaN(v.y)).toBe(false);
    expect(Math.round(v.x * 1000) / 1000).toBe(v.x);
    expect(Math.round(v.y * 1000) / 1000).toBe(v.y);
  }
  // Ни один треугольник не входит в две группы.
  const seen = new Set<number>();
  for (const group of t.groups) {
    for (const ti of group.triangles) {
      expect(seen.has(ti)).toBe(false);
      seen.add(ti);
    }
  }
};

describe('triangulateContours', () => {
  describe('одиночный квадрат outer', () => {
    const t = triangulateContours({ outer: [outerSquare], inner: [] });

    it('4 вершины, 2 треугольника, стороны fixed, диагональ — нет', () => {
      expect(t.vertices).toHaveLength(4);
      expect(t.triangles).toHaveLength(2);
      expect(t.edges).toHaveLength(5);
      expect(edgeBetween(t, 0, 0, 100, 0)?.fixed).toBe(true);
      expect(edgeBetween(t, 100, 0, 100, 100)?.fixed).toBe(true);
      expect(edgeBetween(t, 100, 100, 0, 100)?.fixed).toBe(true);
      expect(edgeBetween(t, 0, 100, 0, 0)?.fixed).toBe(true);
      const diagonal = t.edges.find(e => !e.fixed);
      expect(diagonal).toBeDefined();
      expect(diagonal!.triangles).toHaveLength(2);
      expect(t.edges.filter(e => !e.fixed)).toHaveLength(1);
    });

    it('одна группа: fill, touchesHull, innermost = outer', () => {
      expect(t.groups).toEqual([
        { triangles: [0, 1], fill: true, touchesHull: true, innermost: 'outer', insideOuter: 1, insideInner: 0 },
      ]);
    });

    it('инварианты структуры', () => {
      expectStructureInvariants(t);
    });

    it('вход не мутируется', () => {
      const input = square(0, 0, 100);
      const copy = input.map(v => ({ ...v }));
      triangulateContours({ outer: [input], inner: [] });
      expect(input).toEqual(copy);
    });
  });

  describe('классификация групп', () => {
    it('outer с inner внутри: полость — fill:false, innermost inner, не касается оболочки; кольцо — fill, innermost outer', () => {
      const t = triangulateContours({ outer: [outerSquare], inner: [square(20, 20, 40)] });
      expectStructureInvariants(t);
      expect(t.groups).toHaveLength(2);
      const hole = t.groups.find(g => !g.fill);
      const ring = t.groups.find(g => g.fill);
      expect(hole).toMatchObject({ fill: false, innermost: 'inner', touchesHull: false });
      expect(hole!.triangles).toHaveLength(2);
      expect(ring).toMatchObject({ fill: true, innermost: 'outer', touchesHull: true });
      expect(ring!.triangles).toHaveLength(8);
    });

    it('одиночный inner: одна группа fill:false, innermost inner, касается оболочки', () => {
      const t = triangulateContours({ outer: [], inner: [square(20, 20, 40)] });
      expect(t.groups).toEqual([
        { triangles: [0, 1], fill: false, touchesHull: true, innermost: 'inner', insideOuter: 0, insideInner: 1 },
      ]);
    });

    it('вложенные outer (квадрат в квадрате): ближайший объемлющий — меньший, обе группы outer/fill', () => {
      const t = triangulateContours({ outer: [outerSquare, square(30, 30, 40)], inner: [] });
      expect(t.groups).toHaveLength(2);
      const nested = t.groups.find(g => !g.touchesHull);
      const ring = t.groups.find(g => g.touchesHull);
      expect(nested).toMatchObject({ innermost: 'outer', fill: true });
      expect(ring).toMatchObject({ innermost: 'outer', fill: true });
    });

    it('полость, замкнутая только телами стен (рамка из четырёх outer-квадов): innermost null, не fill, не касается оболочки', () => {
      const wall = (x0: number, y0: number, w: number, h: number) => [
        p(x0, y0),
        p(x0 + w, y0),
        p(x0 + w, y0 + h),
        p(x0, y0 + h),
      ];
      const t = triangulateContours({
        outer: [wall(0, 0, 100, 10), wall(90, 0, 10, 100), wall(0, 90, 100, 10), wall(0, 0, 10, 100)],
        inner: [],
      });
      const cavity = t.groups.find(g => !g.touchesHull);
      expect(cavity).toBeDefined();
      expect(cavity).toMatchObject({ innermost: null, fill: false, touchesHull: false });
      expect(t.groups.filter(g => g.innermost === 'outer').every(g => g.fill)).toBe(true);
    });

    it('маленький outer внутри большого inner: innermost outer — стены внутри комнаты по точкам остаются стенами', () => {
      const t = triangulateContours({ outer: [square(40, 40, 20)], inner: [outerSquare] });
      const wall = t.groups.find(g => !g.touchesHull);
      expect(wall).toMatchObject({ innermost: 'outer', fill: true });
      const room = t.groups.find(g => g.touchesHull);
      expect(room).toMatchObject({ innermost: 'inner', fill: false });
    });

    it('inner той же площади поверх outer (совпадающие контуры): при равенстве площадей — inner, не fill', () => {
      const t = triangulateContours({ outer: [outerSquare], inner: [square(0, 0, 100)] });
      expect(t.groups).toHaveLength(1);
      expect(t.groups[0]).toMatchObject({ innermost: 'inner', fill: false });
    });

    it('точка вне всех контуров (треугольники оболочки между двумя квадратами): innermost null', () => {
      const t = triangulateContours({ outer: [outerSquare, square(200, 0, 100)], inner: [] });
      const outside = t.groups.filter(g => g.innermost === null);
      expect(outside.length).toBeGreaterThan(0);
      expect(outside.every(g => !g.fill && g.touchesHull)).toBe(true);
    });

    it('cutPairs становятся fixed-рёбрами и делят квадрат на две группы', () => {
      const t = triangulateContours({ outer: [outerSquare], inner: [], cutPairs: [[p(50, 0), p(50, 100)]] });
      expectStructureInvariants(t);
      const cut = edgeBetween(t, 50, 0, 50, 100);
      expect(cut?.fixed).toBe(true);
      expect(t.groups).toHaveLength(2);
      expect(t.groups.every(g => g.fill && g.touchesHull && g.innermost === 'outer')).toBe(true);
    });

    it('без cutPairs тот же квадрат с точками (50,0), (50,100) на сторонах — одна группа', () => {
      const t = triangulateContours({
        outer: [[p(0, 0), p(50, 0), p(100, 0), p(100, 100), p(50, 100), p(0, 100)]],
        inner: [],
      });
      expect(t.groups).toHaveLength(1);
    });

    it('bound на левой половине: fill только слева', () => {
      const t = triangulateContours({ outer: [outerSquare], inner: [], bound: [leftHalf], cutPairs: [] });
      expectStructureInvariants(t);
      expect(t.groups).toHaveLength(2);
      const centerX = (g: (typeof t.groups)[number]) => {
        const [a, b, c] = t.triangles[g.triangles[0]!]!;
        return (t.vertices[a]!.x + t.vertices[b]!.x + t.vertices[c]!.x) / 3;
      };
      const left = t.groups.find(g => centerX(g) < 50)!;
      const right = t.groups.find(g => centerX(g) > 50)!;
      expect(left.fill).toBe(true);
      expect(right.fill).toBe(false);
      // Базовая классификация не зависит от bound.
      expect(right).toMatchObject({ innermost: 'outer' });
    });

    it('subtract на левой половине: fill только справа', () => {
      const t = triangulateContours({ outer: [outerSquare], inner: [], subtract: [leftHalf] });
      expect(t.groups).toHaveLength(2);
      const fills = t.groups.map(g => g.fill).sort();
      expect(fills).toEqual([false, true]);
      const centerX = (g: (typeof t.groups)[number]) => {
        const [a, b, c] = t.triangles[g.triangles[0]!]!;
        return (t.vertices[a]!.x + t.vertices[b]!.x + t.vertices[c]!.x) / 3;
      };
      expect(t.groups.find(g => centerX(g) < 50)!.fill).toBe(false);
      expect(t.groups.find(g => centerX(g) > 50)!.fill).toBe(true);
    });

    it('bound и subtract вместе: fill там, где bound покрывает не слабее subtract (обе половины — fill)', () => {
      // Слева: bound 1 ≥ subtract 1; справа: bound 0 ≥ subtract 0 → обе группы fill.
      const t = triangulateContours({ outer: [outerSquare], inner: [], bound: [leftHalf], subtract: [leftHalf] });
      expect(t.groups).toHaveLength(2);
      expect(t.groups.every(g => g.fill)).toBe(true);
    });

    it('bound и subtract вместе: subtract покрывает сильнее bound → не fill', () => {
      // Слева: bound 0 < subtract 1 → не fill; справа: 0 ≥ 0 → fill.
      const t = triangulateContours({
        outer: [outerSquare],
        inner: [],
        bound: [square(200, 200, 10)],
        subtract: [leftHalf],
      });
      const centerX = (g: (typeof t.groups)[number]) => {
        const [a, b, c] = t.triangles[g.triangles[0]!]!;
        return (t.vertices[a]!.x + t.vertices[b]!.x + t.vertices[c]!.x) / 3;
      };
      const inSquare = t.groups.filter(g => g.innermost === 'outer');
      expect(inSquare).toHaveLength(2);
      expect(inSquare.find(g => centerX(g) < 50)!.fill).toBe(false);
      expect(inSquare.find(g => centerX(g) > 50)!.fill).toBe(true);
    });

    it('bound/subtract не делают fill то, что не fill базово (inner без outer)', () => {
      const t = triangulateContours({ outer: [], inner: [square(0, 0, 100)], bound: [square(0, 0, 100)] });
      expect(t.groups.every(g => !g.fill)).toBe(true);
    });

    it('группа из одних узких треугольников отбрасывается: треугольники есть, группы нет', () => {
      const t = triangulateContours({ outer: [[p(0, 0), p(100, 0), p(100, 0.01), p(0, 0.01)]], inner: [] });
      expect(t.triangles).toHaveLength(2);
      expect(t.groups).toEqual([]);
    });

    it('в группе с одним узким треугольником репрезентативный — не узкий, группа остаётся', () => {
      // Квадрат с почти совпадающей вершиной у угла: появляется узкий треугольник, но группа классифицируется.
      const t = triangulateContours({ outer: [[p(0, 0), p(100, 0), p(100, 100), p(0.05, 100), p(0, 100)]], inner: [] });
      expect(t.groups).toHaveLength(1);
      expect(t.groups[0]).toMatchObject({ fill: true, innermost: 'outer' });
    });
  });

  describe('чистка входа', () => {
    it('пересекающиеся outer-квадраты получают вершины пересечений; координаты квантованы, без NaN', () => {
      const t = triangulateContours({ outer: [outerSquare, square(50, 50, 100)], inner: [] });
      expectStructureInvariants(t);
      expect(t.vertices.length).toBeGreaterThan(8);
      expect(findVertex(t, 50, 100)).not.toBe(-1);
      expect(findVertex(t, 100, 50)).not.toBe(-1);
      // Пересечение обоих квадратов — внутренняя группа, innermost outer, fill.
      const overlap = t.groups.find(g => !g.touchesHull);
      expect(overlap).toMatchObject({ fill: true, innermost: 'outer' });
    });

    it('диагональное пересечение (не осевое) — точка пересечения появляется и квантована до 0.001', () => {
      const t = triangulateContours({
        outer: [
          [p(0, 0), p(100, 0), p(100, 10), p(0, 10)],
          [p(10.123, -50), p(20.777, -50), p(90.333, 60), p(80.001, 60)],
        ],
        inner: [],
      });
      expectStructureInvariants(t);
      const keys = new Set(t.vertices.map(vertexKey));
      expect(keys.size).toBe(t.vertices.length);
      expect(t.vertices.length).toBeGreaterThan(8);
    });

    it('дубли точек и обратные дубли рёбер во входе дедупятся: вершин — сколько уникальных', () => {
      const t = triangulateContours({
        outer: [
          [p(0, 0), p(0, 0), p(100, 0), p(100, 100), p(0, 100)],
          [p(0, 100), p(100, 100), p(100, 0), p(0, 0)],
        ],
        inner: [],
      });
      expect(t.vertices).toHaveLength(4);
      expect(t.edges.filter(e => e.fixed)).toHaveLength(4);
      expect(t.triangles).toHaveLength(2);
    });

    it('координаты входа квантуются до 0.001 и почти совпадающие точки сливаются', () => {
      const t = triangulateContours({
        outer: [[p(0.0004, 0), p(100, 0.0002), p(100, 100), p(0, 100.0004)]],
        inner: [],
      });
      expect(t.vertices).toEqual([p(0, 0), p(100, 0), p(100, 100), p(0, 100)]);
    });

    it('рёбра нулевой длины пропускаются (два одинаковых соседних точки контура)', () => {
      const t = triangulateContours({ outer: [[p(0, 0), p(100, 0), p(100, 0), p(100, 100), p(0, 100)]], inner: [] });
      expect(t.vertices).toHaveLength(4);
      expect(t.edges.filter(e => e.fixed)).toHaveLength(4);
      expect(t.groups).toHaveLength(1);
    });

    it('контуры из < 2 точек игнорируются', () => {
      const t = triangulateContours({ outer: [[p(5, 5)], [], outerSquare], inner: [[p(7, 7)]] });
      expect(t.vertices).toHaveLength(4);
      expect(t.groups).toHaveLength(1);
    });

    it('контур из 2 точек — одно ребро, без треугольников', () => {
      const t = triangulateContours({ outer: [[p(0, 0), p(100, 0)]], inner: [] });
      expect(t.vertices).toHaveLength(2);
      expect(t.triangles).toEqual([]);
      expect(t.groups).toEqual([]);
    });

    it('пустой вход → пустая триангуляция без исключения', () => {
      expect(triangulateContours({ outer: [], inner: [] })).toEqual({
        vertices: [],
        triangles: [],
        edges: [],
        triangleEdges: [],
        groups: [],
      });
    });

    it('осевое перекрытие двух outer (общая сторона частично): T-стыки получают общие вершины', () => {
      // Квадраты, соприкасающиеся по x = 100 с частичным перекрытием сторон.
      const t = triangulateContours({ outer: [outerSquare, square(100, 50, 100)], inner: [] });
      expectStructureInvariants(t);
      expect(findVertex(t, 100, 50)).not.toBe(-1);
      expect(t.groups.filter(g => g.fill)).toHaveLength(2);
    });
  });

  describe('property: выпуклый многоугольник как outer', () => {
    it('n − 2 треугольника, одна группа fill, без NaN', () => {
      fc.assert(
        fc.property(arbConvexPolygon, polygon => {
          const t = triangulateContours({ outer: [polygon], inner: [] });
          expect(t.vertices).toHaveLength(polygon.length);
          for (const v of t.vertices) {
            expect(Number.isNaN(v.x)).toBe(false);
            expect(Number.isNaN(v.y)).toBe(false);
          }
          expect(t.triangles).toHaveLength(polygon.length - 2);
          expect(t.groups).toHaveLength(1);
          expect(t.groups[0]).toMatchObject({ fill: true, innermost: 'outer', touchesHull: true });
        }),
        fcParams,
      );
    });
  });
});

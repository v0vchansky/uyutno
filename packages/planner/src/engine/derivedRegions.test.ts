import { triangulateContours } from '../document/geometry/triangulate/triangulateContours';
import type { Id } from '../document/id';
import type { PlanPosition } from '../document/PlannerDocument';
import { createTriangleResolver, innermostIndex, regionPoint } from './derivedRegions';
import { coordinateKey } from './normalizeIds';

const rect = (x0: number, y0: number, x1: number, y1: number): PlanPosition[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const indexOf = (points: readonly PlanPosition[], prefix = 'p'): Map<string, Id> =>
  new Map(points.map((point, index) => [coordinateKey(point), `${prefix}${index + 1}`]));

describe('regionPoint', () => {
  it('центроид первого не узкого треугольника группы — точка внутри её области', () => {
    const triangulation = triangulateContours({ outer: [rect(0, 0, 100, 100)], inner: [] });
    const group = triangulation.groups.find(candidate => candidate.fill)!;
    const point = regionPoint(triangulation, group.triangles)!;
    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(100);
    expect(point.y).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(100);
  });

  it('сливеры пропускаются: первый треугольник узкий — берётся следующий', () => {
    // Вершины подобраны так, что треугольник 0 узкий (сторона 0.01 см < TRIANGLE_NARROW), а треугольник 1 — нет.
    const triangulation = {
      vertices: [
        { x: 0, y: 0 },
        { x: 0.01, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
      triangles: [
        [0, 1, 2],
        [0, 2, 3],
      ] as [number, number, number][],
      edges: [],
      triangleEdges: [],
      groups: [],
    };
    expect(regionPoint(triangulation, [0, 1])).toEqual({ x: (0 + 0 + 100) / 3, y: (0 + 100 + 100) / 3 });
  });

  it('группа из одних сливеров → null', () => {
    const triangulation = {
      vertices: [
        { x: 0, y: 0 },
        { x: 0.01, y: 0 },
        { x: 0, y: 0.01 },
      ],
      triangles: [[0, 1, 2]] as [number, number, number][],
      edges: [],
      triangleEdges: [],
      groups: [],
    };
    expect(regionPoint(triangulation, [0])).toBeNull();
    expect(regionPoint(triangulation, [])).toBeNull();
  });
});

describe('innermostIndex', () => {
  const outerRect = rect(0, 0, 100, 100);
  const innerRect = rect(20, 20, 40, 40);

  it('вложенные контуры: побеждает наименьший по площади, а не первый в наборе', () => {
    expect(innermostIndex({ x: 30, y: 30 }, [outerRect, innerRect])).toBe(1);
    expect(innermostIndex({ x: 30, y: 30 }, [innerRect, outerRect])).toBe(0);
  });

  it('точка вне вложенного — достаётся объемлющему', () => {
    expect(innermostIndex({ x: 80, y: 80 }, [outerRect, innerRect])).toBe(0);
  });

  it('граница не считается вложенностью (строгое `pointInContour`), пустой набор и промах → null', () => {
    expect(innermostIndex({ x: 0, y: 0 }, [outerRect])).toBeNull();
    expect(innermostIndex({ x: 500, y: 500 }, [outerRect, innerRect])).toBeNull();
    expect(innermostIndex({ x: 30, y: 30 }, [])).toBeNull();
  });

  it('равные площади: побеждает первый — тай-брейк детерминирован', () => {
    expect(innermostIndex({ x: 30, y: 30 }, [rect(20, 20, 40, 40), rect(21, 20, 41, 40)])).toBe(0);
  });
});

describe('createTriangleResolver', () => {
  const square = rect(0, 0, 100, 100);

  it('вершины резолвятся по квантованной координате, треугольники — по id точек', () => {
    const triangulation = triangulateContours({ outer: [square], inner: [] });
    const resolver = createTriangleResolver(triangulation, indexOf(square), () => {
      throw new Error('не должно звучать');
    });
    const fill = triangulation.groups.find(group => group.fill)!;
    const triangles = resolver.triangles(fill.triangles);
    expect(triangles).toHaveLength(fill.triangles.length);
    for (const triangle of triangles) for (const id of triangle) expect(id).toMatch(/^p[1-4]$/);
  });

  it('вершина без точки этажа: треугольник пропущен, `onMissing` — ровно один раз на резолвер', () => {
    const triangulation = triangulateContours({ outer: [square], inner: [] });
    let calls = 0;
    const partial = indexOf(square);
    partial.delete(coordinateKey({ x: 100, y: 100 }));
    const resolver = createTriangleResolver(triangulation, partial, () => {
      calls++;
    });
    expect(resolver.vertex(0)).not.toBeNull();
    const fill = triangulation.groups.find(group => group.fill)!;
    const triangles = resolver.triangles(fill.triangles);
    expect(triangles.length).toBeLessThan(fill.triangles.length);
    resolver.triangles(fill.triangles);
    expect(calls).toBe(1);
  });

  it('индекс вне диапазона вершин → null, а не исключение', () => {
    const triangulation = triangulateContours({ outer: [square], inner: [] });
    const resolver = createTriangleResolver(triangulation, indexOf(square), () => {});
    expect(resolver.vertex(999)).toBeNull();
    expect(resolver.triangles([])).toEqual([]);
  });
});

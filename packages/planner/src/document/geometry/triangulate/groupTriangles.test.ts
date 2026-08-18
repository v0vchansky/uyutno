import { type TriangleAdjacency, groupTriangles } from './groupTriangles';
import type { TriangleIndices, TriangulationEdge } from './triangulateContours';

/**
 * Сборка half-edge-lite структуры по списку треугольников (индексы вершин) и множеству fixed-рёбер
 * (ключ `min|max`) — тот же способ, что у `triangulateContours`.
 */
const buildAdjacency = (triangles: TriangleIndices[], fixed: readonly string[] = []): TriangleAdjacency => {
  const fixedKeys = new Set(fixed);
  const edges: TriangulationEdge[] = [];
  const index = new Map<string, number>();
  const triangleEdges = triangles.map((triangle, t) => {
    const sides: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = triangle[i]!;
      const b = triangle[(i + 1) % 3]!;
      const key = `${Math.min(a, b)}|${Math.max(a, b)}`;
      let e = index.get(key);
      if (e === undefined) {
        e = edges.length;
        edges.push({ a: Math.min(a, b), b: Math.max(a, b), fixed: fixedKeys.has(key), triangles: [] });
        index.set(key, e);
      }
      edges[e]!.triangles.push(t);
      sides.push(e);
    }
    return sides as [number, number, number];
  });
  return { triangles, edges, triangleEdges };
};

/** Полоса из `n` треугольников на вершинах 0..n+1: треугольник `t` = (t, t+1, t+2), сосед по ребру (t+1, t+2). */
const strip = (n: number): TriangleIndices[] => Array.from({ length: n }, (_, t) => [t, t + 1, t + 2]);

describe('groupTriangles', () => {
  // Квадрат 0-1-2-3, диагональ 1-3: треугольники (0,1,3) и (1,2,3); плюс треугольник (1,4,2) снаружи через ребро 1-2.
  const triangles: TriangleIndices[] = [
    [0, 1, 3],
    [1, 2, 3],
    [1, 4, 2],
  ];

  it('без разделения по fixed все смежные треугольники — одна группа', () => {
    const adjacency = buildAdjacency(triangles, ['1|3']);
    expect(groupTriangles(adjacency, [0, 1, 2], false)).toEqual([[0, 1, 2]]);
  });

  it('fixed-ребро — барьер при separateByFixedEdges = true', () => {
    const adjacency = buildAdjacency(triangles, ['1|3']);
    expect(groupTriangles(adjacency, [0, 1, 2], true)).toEqual([[0], [1, 2]]);
  });

  it('не-fixed рёбра пересекаются и при separateByFixedEdges = true', () => {
    const adjacency = buildAdjacency(triangles);
    expect(groupTriangles(adjacency, [0, 1, 2], true)).toEqual([[0, 1, 2]]);
  });

  it('ребро оболочки (один инцидентный треугольник) не пересекается — обход не падает и не «выходит наружу»', () => {
    const adjacency = buildAdjacency([[0, 1, 2]]);
    expect(adjacency.edges.every(edge => edge.triangles.length === 1)).toBe(true);
    expect(groupTriangles(adjacency, [0], false)).toEqual([[0]]);
  });

  it('обходятся только треугольники из subset: треугольник вне subset не соединяет два треугольника subset', () => {
    // 0 и 2 соединены только через 1.
    const adjacency = buildAdjacency(triangles);
    expect(groupTriangles(adjacency, [0, 2], false)).toEqual([[0], [2]]);
  });

  it('стартовые треугольники вне subset не появляются; порядок групп — по порядку subset', () => {
    const adjacency = buildAdjacency(triangles, ['1|3']);
    expect(groupTriangles(adjacency, [2, 1], true)).toEqual([[1, 2]]);
    expect(groupTriangles(adjacency, [2, 0], true)).toEqual([[2], [0]]);
  });

  it('треугольники внутри группы отсортированы по возрастанию независимо от порядка обхода', () => {
    // Полоса из 5: старт с середины — обход идёт в обе стороны, но группа отсортирована.
    const adjacency = buildAdjacency(strip(5));
    expect(groupTriangles(adjacency, [2, 0, 1, 3, 4], false)).toEqual([[0, 1, 2, 3, 4]]);
  });

  it('пустой subset → []', () => {
    const adjacency = buildAdjacency(triangles);
    expect(groupTriangles(adjacency, [], false)).toEqual([]);
  });

  it('дубли в subset не дают повторных групп', () => {
    const adjacency = buildAdjacency(triangles, ['1|3']);
    expect(groupTriangles(adjacency, [0, 0, 1, 2, 1], true)).toEqual([[0], [1, 2]]);
  });

  it('длинная цепочка из 20 000 треугольников группируется без переполнения стека (явный стек)', () => {
    const n = 20_000;
    const adjacency = buildAdjacency(strip(n));
    const subset = Array.from({ length: n }, (_, t) => t);
    const groups = groupTriangles(adjacency, subset, true);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(n);
    expect(groups[0]![0]).toBe(0);
    expect(groups[0]![n - 1]).toBe(n - 1);
  });

  it('fixed-ребро посреди длинной цепочки делит её ровно на две группы', () => {
    const n = 1000;
    // Общее ребро треугольников 499 и 500 — (500, 501).
    const adjacency = buildAdjacency(strip(n), ['500|501']);
    const groups = groupTriangles(
      adjacency,
      Array.from({ length: n }, (_, t) => t),
      true,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(500);
    expect(groups[1]).toHaveLength(500);
    expect(groups[1]![0]).toBe(500);
  });
});

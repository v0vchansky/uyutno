import type { TriangleIndices, TriangulationEdge } from './triangulateContours';

/** Минимум структуры триангуляции, нужный flood-fill: рёбра с инцидентными треугольниками и рёбра треугольников. */
export interface TriangleAdjacency {
  triangles: readonly TriangleIndices[];
  edges: readonly TriangulationEdge[];
  triangleEdges: readonly (readonly [number, number, number])[];
}

/**
 * Flood-fill связных групп треугольников по общим рёбрам (ADR 0017 C6, `groupTriangles` референса) —
 * **явным стеком**, без рекурсии (единственный «landmine» аудита dd01/dd03). Обходятся только треугольники
 * из `subset` (индексы), переходы — только внутрь `subset`; `separateByFixedEdges` — не пересекать fixed-рёбра
 * (стены как барьеры); ребро на оболочке (один инцидентный треугольник) не пересекается никогда.
 * Порядок групп и треугольников в группе — по возрастанию индекса стартового треугольника / порядку обхода:
 * детерминирован входом.
 */
export const groupTriangles = (
  { edges, triangleEdges }: TriangleAdjacency,
  subset: readonly number[],
  separateByFixedEdges: boolean,
): number[][] => {
  const allowed = new Set(subset);
  const visited = new Set<number>();
  const groups: number[][] = [];

  for (const start of subset) {
    if (visited.has(start)) continue;
    const group: number[] = [];
    const stack: number[] = [start];
    visited.add(start);
    while (stack.length > 0) {
      const t = stack.pop()!;
      group.push(t);
      for (const e of triangleEdges[t]!) {
        const edge = edges[e]!;
        if (edge.fixed && separateByFixedEdges) continue;
        if (edge.triangles.length <= 1) continue;
        const other = edge.triangles[0] === t ? edge.triangles[1]! : edge.triangles[0]!;
        if (!allowed.has(other) || visited.has(other)) continue;
        visited.add(other);
        stack.push(other);
      }
    }
    group.sort((a, b) => a - b);
    groups.push(group);
  }
  return groups;
};

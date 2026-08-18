import type { PlanPosition } from '../../PlannerDocument';
import { segmentsIntersected } from './segmentsIntersected';

/**
 * Самопересечение контура: есть пара рёбер, пересекающихся трансверсально (`segmentsIntersected`).
 * `closed = true` (дефолт) — рёбра включают замыкающее `last→first`; `false` — открытая полилиния.
 * O(n²) — контуры маленькие. Касание вершиной, наложение и общая вершина не считаются (как референс);
 * дубли точек ловит `validateContour` отдельно.
 */
export const contourSelfIntersected = (contour: readonly PlanPosition[], closed = true): boolean => {
  const n = contour.length;
  const edges = closed ? n : n - 1;
  if (edges < 2) return false;
  for (let i = 0; i < edges; i++) {
    const a = contour[i]!;
    const b = contour[(i + 1) % n]!;
    for (let j = i + 1; j < edges; j++) {
      const c = contour[j]!;
      const d = contour[(j + 1) % n]!;
      if (segmentsIntersected(a, b, c, d)) return true;
    }
  }
  return false;
};

import type { PlanPosition } from '../../PlannerDocument';

/** Ограничивающий прямоугольник набора точек плана. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** bbox контура/набора точек; пустой массив → `null` (у референса гарда нет — `±MAX_VALUE`). */
export const findMinMax = (points: readonly PlanPosition[]): Bounds | null => {
  const first = points[0];
  if (!first) return null;
  const bounds: Bounds = { minX: first.x, minY: first.y, maxX: first.x, maxY: first.y };
  for (const point of points) {
    if (point.x < bounds.minX) bounds.minX = point.x;
    if (point.x > bounds.maxX) bounds.maxX = point.x;
    if (point.y < bounds.minY) bounds.minY = point.y;
    if (point.y > bounds.maxY) bounds.maxY = point.y;
  }
  return bounds;
};

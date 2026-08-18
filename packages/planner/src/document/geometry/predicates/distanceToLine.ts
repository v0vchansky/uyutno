import type { PlanPosition } from '../../PlannerDocument';
import { euclDist } from './distance';
import { L_EPS } from './pointsMatch';

/**
 * Расстояние от точки до **бесконечной прямой** через `a`, `b` — всегда неотрицательное (ADR 0017 C4:
 * знак референса нигде не использовался, ориентация — через `orient2d`). Гард вырожденной прямой:
 * при `|ab| < L_EPS` прямая не определена — возвращается расстояние до `a` (а не `NaN`).
 */
export const distanceToLine = (point: PlanPosition, a: PlanPosition, b: PlanPosition): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length >= L_EPS)) return euclDist(point, a);
  return Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length;
};

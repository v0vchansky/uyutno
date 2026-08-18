import type { PlanPosition } from '../../PlannerDocument';
import { L_EPS } from './pointsMatch';

/**
 * Точка внутри bbox отрезка `ab` (порядок концов любой) со слаком `accuracy` по каждой оси, включительно.
 * Пост-фильтр после проекций/пересечений и гард спайка в правиле митра (ADR 0017 C4/C5). `NaN` → `false`.
 */
export const pointInBounds = (
  point: PlanPosition,
  a: PlanPosition,
  b: PlanPosition,
  accuracy: number = L_EPS,
): boolean =>
  point.x >= Math.min(a.x, b.x) - accuracy &&
  point.x <= Math.max(a.x, b.x) + accuracy &&
  point.y >= Math.min(a.y, b.y) - accuracy &&
  point.y <= Math.max(a.y, b.y) + accuracy;

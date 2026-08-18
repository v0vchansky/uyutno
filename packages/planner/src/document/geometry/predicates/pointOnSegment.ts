import type { PlanPosition } from '../../PlannerDocument';
import { euclDist } from './distance';

/**
 * Эпсилон близости к границе (ADR 0017 C3): точка на отрезке / на контуре, вырожденные (нулевые) рёбра.
 * Допускает накопленный float-шум порядка 1e-4 см; тождество координат — отдельный `L_EPS`.
 */
export const B_EPS = 1e-4;

/**
 * Точка лежит на отрезке `ab` с коридором `accuracy` (ADR 0017 C4, rework `pointOnLine` референса):
 * параметрически — проекция `t ∈ [−accuracy/|ab|, 1 + accuracy/|ab|]` вдоль отрезка **и** поперечное
 * расстояние до прямой `< accuracy`. Коридор изотропный: концы захватываются на `accuracy` вдоль оси,
 * а не по bbox со слаком (у референса точка «за» концом ловилась только по осям bbox).
 * Вырожденный отрезок (`|ab| < accuracy`) — сводится к близости к `a`. `NaN` во входе → `false`.
 */
export const pointOnSegment = (
  point: PlanPosition,
  a: PlanPosition,
  b: PlanPosition,
  accuracy: number = B_EPS,
): boolean => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length >= accuracy)) return euclDist(point, a) < accuracy;
  const px = point.x - a.x;
  const py = point.y - a.y;
  const along = (px * dx + py * dy) / length;
  if (!(along >= -accuracy && along <= length + accuracy)) return false;
  const across = Math.abs(px * dy - py * dx) / length;
  return across < accuracy;
};
